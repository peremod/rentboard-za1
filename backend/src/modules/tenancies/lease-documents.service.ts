import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AddLeaseDocumentDto, UpdateLeaseDocumentDto } from './dto/lease-document.dto';

/**
 * Keeping the lease, and nothing more than keeping it.
 *
 * ── What this deliberately is not
 *
 * Storage. Not signing. There is no endpoint here that records agreement, no
 * signature, no hash chain, no trusted timestamp, and no field that could be
 * read as one. A landlord and a tenant sign on paper; this holds the photograph
 * so neither of them has to find it in a drawer in eighteen months.
 *
 * That line is drawn on purpose and is the reason Phase 4e was flagged before it
 * was built. E-signature is execution of a legal document: under the ECT Act an
 * "advanced electronic signature" is a specific accredited thing, and a product
 * that collects a finger-drawn squiggle and files it next to a lease invites
 * both parties to believe something about enforceability that nobody here has
 * advice to support. A half-built e-signature is worse than none, because it
 * looks like one.
 *
 * ── Who may see a lease
 *
 * Both parties, and nobody else — not other landlords, and NOT admins. This is
 * the one document store in the codebase with no admin queue, which is a
 * decision rather than an omission: a lease names two people, what they pay and
 * where they sleep, and there is no support task that requires reading it. The
 * verification queue exists because an admin must check an ID against a claim.
 * Nothing equivalent is true here.
 *
 * Either party may upload. Only the uploader may change or remove their own
 * upload, so one side cannot quietly delete the other's copy of what was agreed
 * — which is the whole value of both of them having it.
 *
 * ── Retention
 *
 * Kept, unlike a verification document, and that difference is deliberate. A
 * lease is personal information about both parties (POPIA s.1), not special
 * personal information (s.26): it is a contract, not an identity document, and
 * both people need it for as long as it can be disputed. Deleting the only copy
 * of an agreement would be the harm, not the safeguard.
 *
 * Kept is not kept forever. Removal is a REAL deletion — the bytes leave
 * ImageKit through StorageService's queue, not merely the row. That distinction
 * exists because it did not before: see StorageService's own header.
 */
@Injectable()
export class LeaseDocumentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  /**
   * The tenancy, if this person is party to it.
   *
   * Landlord OR tenant, checked in one query rather than fetching and comparing
   * — so a caller who is neither cannot tell a tenancy that exists from one that
   * does not, and cannot enumerate tenancy ids.
   */
  private async tenancyForParty(tenancyId: string, userId: string) {
    const tenancy = await this.prisma.tenancy.findFirst({
      where: { id: tenancyId, OR: [{ landlordId: userId }, { tenantId: userId }] },
      select: {
        id: true,
        landlordId: true,
        tenantId: true,
        room: { select: { id: true, title: true } },
      },
    });
    if (!tenancy) throw new NotFoundException('Tenancy not found');
    return tenancy;
  }

  /**
   * Every document on a tenancy, for either party.
   *
   * `path` is stripped from the response. A reader gets a signed, short-lived
   * URL from the read endpoint instead, so the storage location is never sitting
   * in a JSON payload or a browser history entry.
   */
  async list(tenancyId: string, userId: string) {
    await this.tenancyForParty(tenancyId, userId);
    const docs = await this.prisma.leaseDocument.findMany({
      where: { tenancyId },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map(({ path, ...rest }) => ({
      ...rest,
      // Said rather than implied: the list tells each party whether a document
      // is theirs to change, so the UI does not have to compare ids itself and
      // get it wrong.
      mine: rest.uploadedById === userId,
    }));
  }

  async add(tenancyId: string, dto: AddLeaseDocumentDto, userId: string) {
    await this.tenancyForParty(tenancyId, userId);
    const created = await this.prisma.leaseDocument.create({
      data: {
        tenancyId,
        uploadedById: userId,
        kind: dto.kind ?? 'lease',
        path: dto.path.replace(/^\/+/, ''),
        label: dto.label.trim(),
        sizeBytes: dto.sizeBytes ?? null,
        contentType: dto.contentType ?? null,
        note: dto.note?.trim() || null,
      },
    });
    const { path, ...safe } = created;
    return { ...safe, mine: true };
  }

  /** Label, kind and note. Never the file — replacing it is remove plus add. */
  async update(id: string, dto: UpdateLeaseDocumentDto, userId: string) {
    const doc = await this.prisma.leaseDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.tenancyForParty(doc.tenancyId, userId);
    if (doc.uploadedById !== userId) {
      throw new ForbiddenException(
        'Only the person who uploaded a document can change it. The other party keeps their own copy of what was agreed.',
      );
    }
    const updated = await this.prisma.leaseDocument.update({
      where: { id },
      data: {
        label: dto.label?.trim(),
        kind: dto.kind,
        // An empty string clears the note; undefined leaves it alone.
        note: dto.note === undefined ? undefined : dto.note.trim() || null,
      },
    });
    const { path, ...safe } = updated;
    return { ...safe, mine: true };
  }

  /**
   * Remove a document, and actually delete the file.
   *
   * The row and the queue entry go in one transaction, so there is no state
   * where the document has vanished from the list while nothing is tracking the
   * bytes — which is exactly the state verification decisions used to leave
   * behind, permanently.
   */
  async remove(id: string, userId: string) {
    const doc = await this.prisma.leaseDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.tenancyForParty(doc.tenancyId, userId);
    if (doc.uploadedById !== userId) {
      throw new ForbiddenException(
        'Only the person who uploaded a document can remove it. One party cannot delete the other’s copy of the lease.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.leaseDocument.delete({ where: { id } });
      await this.storage.enqueueDelete(tx, doc.path, 'lease_document_removed');
    });
    return { deleted: true as const };
  }

  /**
   * A short-lived URL for reading one document. Party-only.
   *
   * Separate from `list` so a location leaves the server when somebody is
   * actually opening a document, rather than sitting in every list response and
   * every cached payload.
   *
   * Signed and expiring, rather than the raw path. The path alone is what the
   * admin verification queue has always linked to, and it resolved against the
   * app's own origin — so that link 404'd for its entire life. Five minutes is
   * enough to open a file and short enough that a URL copied into a WhatsApp
   * group stops working.
   */
  async openUrlFor(id: string, userId: string) {
    const doc = await this.prisma.leaseDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.tenancyForParty(doc.tenancyId, userId);
    const { url, expiresAt } = this.storage.signedUrl(doc.path);
    return { url, expiresAt, contentType: doc.contentType, label: doc.label };
  }
}
