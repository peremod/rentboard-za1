import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** What one deletion attempt actually did. Reported, never guessed. */
export type DeleteOutcome =
  | { state: 'deleted' }
  /** ImageKit had no such file. Distinct from `deleted`: nothing was removed. */
  | { state: 'already_gone' }
  /** Still there. `retryable` is false for a fault repeating will not fix. */
  | { state: 'failed'; error: string; retryable: boolean };

/** A transaction client, so an enqueue can commit with the row that caused it. */
type Tx = Prisma.TransactionClient;

/**
 * Deleting stored files, for real, and proving it.
 *
 * ── The defect this was written for
 *
 * Nothing in this codebase had ever deleted a file. Deciding a verification
 * cleared `documentPath`, set `documentDeletedAt`, and wrote an audit event
 * reading "The uploaded document was deleted. Only this outcome is kept —
 * POPIA s.26." There was no ImageKit SDK in package.json and no call to its
 * delete API anywhere. The reference went; the ID photograph stayed.
 *
 * Three live statements said otherwise, one of them statutory — the privacy
 * policy's ImageKit row, the PAIA manual, and the reassurance shown to a tenant
 * at the moment they upload their ID. The person relying on those is the one who
 * handed over their identity document, which is why this is the first thing
 * fixed rather than a note in a backlog.
 *
 * ── Why it is a queue
 *
 * The bytes are at a third party, so deletion fails for reasons that are not
 * about us. A call made and not checked is how the original bug would come
 * back — quietly, and with the same audit event asserting success. So:
 *
 *   · the FileDeletion row is written in the same transaction as the change
 *     that orphaned the file, so a committed decision always has a pending
 *     deletion behind it;
 *   · `deletedAt` is set from ImageKit's response and never optimistically;
 *   · a row that keeps failing stays in the table, countable, rather than
 *     becoming a log line nobody reads.
 *
 * ── Why the API base is configurable
 *
 * `IMAGEKIT_API_BASE` exists so this can be driven against a stub. Without it
 * the only way to "verify" deletion on a machine with no ImageKit credentials
 * is to read the code and believe it — which is precisely the standard that let
 * the original bug ship. scripts/storage-drive.mjs points it at a local server
 * that records what it receives, so the test is that a DELETE actually arrived
 * for the right file, and that a 500 does NOT mark the row deleted.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private get privateKey(): string | undefined {
    return this.config.get<string>('imagekit.privateKey');
  }

  private get apiBase(): string {
    return (
      this.config.get<string>('imagekit.apiBase') ?? 'https://api.imagekit.io'
    ).replace(/\/+$/, '');
  }

  private get urlEndpoint(): string | undefined {
    return this.config.get<string>('imagekit.urlEndpoint');
  }

  /**
   * A short-lived URL for reading one private file.
   *
   * ── Why this had to be built for a storage-only feature
   *
   * Because nothing here could read a private file at all. The admin
   * verification queue links to `req.documentPath` directly — a bare relative
   * path with no endpoint and no signature — so "Open document ↗" resolved
   * against the app's own origin and 404'd. Every private upload in this
   * codebase was write-only.
   *
   * A lease nobody can open is not a stored lease, so signing is part of Phase
   * 4e rather than a follow-up.
   *
   * ── The algorithm
   *
   * ImageKit's: HMAC-SHA1, keyed with the private key, over the URL with the
   * endpoint prefix removed and the expiry timestamp appended — then `ik-t` and
   * `ik-s` added as query parameters. Matching their SDK exactly matters,
   * because a signature that is merely plausible produces a 401 that looks like
   * a permissions problem.
   *
   * NOTE ON VERIFICATION: this cannot be checked against ImageKit from a machine
   * with no credentials. scripts/storage-drive.mjs recomputes the signature
   * independently and checks ours matches, plus the expiry window and that the
   * private key never appears in the output — so the implementation is proven
   * self-consistent and correctly shaped. Whether ImageKit ACCEPTS it is the one
   * thing only a real key can answer; see PRE-LAUNCH-CHECKLIST.
   */
  signedUrl(path: string, validForSeconds = 300): { url: string; expiresAt: Date } {
    const key = this.privateKey;
    const endpoint = this.urlEndpoint;
    if (!key || !endpoint) {
      // Explicit rather than a broken link. The old admin link failed silently,
      // which is why nobody noticed it had never worked.
      throw new ServiceUnavailableException(
        'Private documents cannot be opened on this server. Set IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT.',
      );
    }
    const base = endpoint.replace(/\/+$/, '');
    const clean = path.replace(/^\/+/, '');
    const expiry = Math.floor(Date.now() / 1000) + validForSeconds;
    // The endpoint prefix is removed before signing, so what is hashed is the
    // path as ImageKit sees it plus the expiry — their SDK's `replacedUrl`.
    const signature = crypto.createHmac('sha1', key).update(`${clean}${expiry}`).digest('hex');
    return {
      url: `${base}/${clean}?ik-t=${expiry}&ik-s=${signature}`,
      expiresAt: new Date(expiry * 1000),
    };
  }

  /**
   * Record that a file must go. Takes a transaction client on purpose.
   *
   * The caller passes the `tx` it is already inside, so the queue row and the
   * cleared reference commit or roll back together. Enqueueing outside the
   * transaction would allow a rolled-back decision to still delete the
   * document, and a committed one to leave the file with nothing tracking it.
   */
  async enqueueDelete(
    tx: Tx,
    path: string,
    reason: string,
    verificationRequestId?: string,
  ) {
    if (!path) return null;
    return tx.fileDeletion.create({
      data: { path, reason, verificationRequestId: verificationRequestId ?? null },
    });
  }

  /**
   * Try one file. Returns what happened; does not throw for a storage fault.
   *
   * Two calls, because ImageKit deletes by fileId and we store a path: resolve
   * the path, then delete the id. A path that resolves to nothing is
   * `already_gone` — the right answer for a file deleted twice, and reported as
   * its own state rather than as success, because "it was not there" and "we
   * removed it" are different facts.
   */
  async deleteByPath(path: string): Promise<DeleteOutcome> {
    const key = this.privateKey;
    if (!key) {
      // Not retryable: waiting will not produce a credential. Said plainly
      // because a silent no-op here is the original bug.
      return {
        state: 'failed',
        retryable: false,
        error:
          'IMAGEKIT_PRIVATE_KEY is not set, so stored files cannot be deleted. Retention promises in the privacy policy and PAIA manual are not being kept while this is unset.',
      };
    }
    // Basic auth, private key as the username and an empty password — what
    // ImageKit's management API expects.
    const auth = `Basic ${Buffer.from(`${key}:`).toString('base64')}`;

    let fileId: string;
    try {
      // The stored path has no leading slash; the search query needs one.
      const query = `filePath="/${path.replace(/^\/+/, '')}"`;
      const res = await fetch(
        `${this.apiBase}/v1/files?searchQuery=${encodeURIComponent(query)}`,
        { headers: { Authorization: auth } },
      );
      if (!res.ok) {
        return {
          state: 'failed',
          retryable: res.status >= 500 || res.status === 429,
          error: `lookup failed: ${res.status} ${(await res.text()).slice(0, 300)}`,
        };
      }
      const found = (await res.json()) as { fileId?: string }[];
      if (!Array.isArray(found) || found.length === 0) return { state: 'already_gone' };
      if (!found[0].fileId) {
        return { state: 'failed', retryable: false, error: 'lookup returned no fileId' };
      }
      fileId = found[0].fileId;
    } catch (e) {
      // A network fault, not a refusal. Worth retrying.
      return { state: 'failed', retryable: true, error: `lookup error: ${String(e).slice(0, 300)}` };
    }

    try {
      const res = await fetch(`${this.apiBase}/v1/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      // 204 is the documented success. 404 means someone else got there first,
      // which is the outcome we wanted either way.
      if (res.status === 204 || res.status === 200) return { state: 'deleted' };
      if (res.status === 404) return { state: 'already_gone' };
      return {
        state: 'failed',
        retryable: res.status >= 500 || res.status === 429,
        error: `delete failed: ${res.status} ${(await res.text()).slice(0, 300)}`,
      };
    } catch (e) {
      return { state: 'failed', retryable: true, error: `delete error: ${String(e).slice(0, 300)}` };
    }
  }

  /**
   * Give up after this many tries.
   *
   * Not unlimited: a path that will never resolve would otherwise be retried
   * forever and the queue depth would stop meaning anything. A row at the cap
   * stays in the table with its last error — it is a thing to fix, not a thing
   * to forget.
   */
  private static readonly MAX_ATTEMPTS = 8;

  /**
   * Work the outstanding queue. Returns counts, so a caller can assert on them.
   *
   * `limit` keeps one pass bounded; the cron comes round again. Rows are taken
   * oldest first, because the oldest outstanding deletion is the one that has
   * been promised for longest.
   */
  async drain(limit = 25) {
    const due = await this.prisma.fileDeletion.findMany({
      where: { deletedAt: null, attempts: { lt: StorageService.MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let deleted = 0;
    let alreadyGone = 0;
    let failed = 0;

    for (const row of due) {
      const outcome = await this.deleteByPath(row.path);

      if (outcome.state === 'deleted' || outcome.state === 'already_gone') {
        await this.prisma.fileDeletion.update({
          where: { id: row.id },
          data: {
            deletedAt: new Date(),
            alreadyGone: outcome.state === 'already_gone',
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
            lastError: null,
          },
        });
        if (outcome.state === 'deleted') deleted++;
        else alreadyGone++;
        await this.noteOnVerificationTrail(row.verificationRequestId, outcome.state);
      } else {
        await this.prisma.fileDeletion.update({
          where: { id: row.id },
          data: {
            // A non-retryable fault still consumes the budget, so a misconfigured
            // server does not spin on the same row every five minutes.
            attempts: outcome.retryable ? { increment: 1 } : StorageService.MAX_ATTEMPTS,
            lastAttemptAt: new Date(),
            lastError: outcome.error,
          },
        });
        failed++;
        this.log.warn(`file deletion failed for ${row.path}: ${outcome.error}`);
      }
    }
    return { attempted: due.length, deleted, alreadyGone, failed };
  }

  /**
   * Tell the subject's own audit trail when the bytes actually went.
   *
   * The decision already recorded that the document was taken out of view. This
   * is the second, stronger fact, and it is written when it becomes true rather
   * than asserted alongside the first.
   */
  private async noteOnVerificationTrail(
    requestId: string | null,
    state: 'deleted' | 'already_gone',
  ) {
    if (!requestId) return;
    // The request may have been removed in the meantime; the deletion still
    // had to happen, so a missing trail is not an error.
    const exists = await this.prisma.verificationRequest.findUnique({
      where: { id: requestId },
      select: { id: true },
    });
    if (!exists) return;
    await this.prisma.verificationEvent.create({
      data: {
        requestId,
        actor: 'system',
        step: 'document_deleted',
        detail:
          state === 'deleted'
            ? 'The uploaded document has been deleted from storage. Only this outcome is kept — POPIA s.26.'
            : 'The uploaded document was already absent from storage; nothing remains of it.',
      },
    });
  }

  /**
   * Hourly rather than daily. A retention promise measured in "once reviewed"
   * should not have a day of slack in it, and the queue is normally empty, so
   * the cost of looking is a single indexed query.
   */
  @Cron('20 * * * *', { timeZone: 'Africa/Johannesburg' })
  async drainOnSchedule() {
    const outstanding = await this.prisma.fileDeletion.count({ where: { deletedAt: null } });
    if (outstanding === 0) return;
    const result = await this.drain();
    this.log.log(
      `file deletions: ${result.deleted} deleted, ${result.alreadyGone} already gone, ${result.failed} failed`,
    );
    // Said at error level on purpose: a file we promised to delete and have
    // not is a compliance fact, not a background detail.
    const stuck = await this.prisma.fileDeletion.count({
      where: { deletedAt: null, attempts: { gte: StorageService.MAX_ATTEMPTS } },
    });
    if (stuck > 0) {
      this.log.error(
        `${stuck} file(s) could not be deleted after ${StorageService.MAX_ATTEMPTS} attempts. The privacy policy and PAIA manual both promise these are deleted. Check file_deletions.lastError.`,
      );
    }
  }
}
