import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma, RoomType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeText } from '../../common/utils/sanitize.util';
import { normaliseSaMobile } from '../../common/utils/phone.util';
import { parseRent, parseRoomType, buildTitle } from './listing-parser';

/** A conversation goes quiet for this long and the draft stops being live. */
const ABANDON_AFTER_DAYS = 14;
/** Matches the 20-photo cap the wizard and the DTOs enforce. */
const MAX_PHOTOS = 20;

/**
 * WhatsApp-first listing creation.
 *
 * Most landlords in this market live on WhatsApp and will not fill in a
 * multi-step web wizard on a phone. They send photos and a sentence to a
 * number, and a draft is waiting when they next open the site.
 *
 * **Nothing published here goes live.** The draft becomes a Room in `draft`
 * status only when the landlord claims it on the web, and then still has to
 * pass the ordinary publish rules. A listing is a commitment to a stranger
 * about somewhere they might live; it does not get published on a parser's
 * guess, and the review step is what makes a deliberately dumb parser safe.
 *
 * **Only verified landlords.** The sender is matched on `phoneVerified`,
 * because `User.phone` is typed in and unchecked — matching on it would let
 * anyone who knew a landlord's number create listings as them. An
 * unrecognised number is told how to link, once, and then ignored.
 */

/**
 * The fields of Meta's inbound message object this bot reads.
 *
 * Deliberately narrow: Meta's payload carries far more than we use, and
 * naming only what we touch keeps the parsing surface — and therefore the
 * personal information we handle — visible in one place.
 */
interface InboundMessage {
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
}

@Injectable()
export class ListingBotService {
  private readonly logger = new Logger(ListingBotService.name);
  private readonly apiVersion: string;
  private readonly accessToken?: string;
  private readonly imagekitPrivateKey?: string;
  private readonly frontendUrl: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.apiVersion = this.config.get<string>('whatsapp.apiVersion') ?? 'v19.0';
    this.accessToken = this.config.get<string>('whatsapp.accessToken');
    this.imagekitPrivateKey = this.config.get<string>('imagekit.privateKey');
    this.frontendUrl = (this.config.get<string>('frontendUrl') ?? '').replace(/\/$/, '');
  }

  /** The verified landlord behind a wa_id, or null. */
  async landlordFor(waId: string) {
    const phone = normaliseSaMobile(waId);
    if (!phone) return null;
    return this.prisma.user.findFirst({
      where: { phone, phoneVerified: true, role: 'LANDLORD', isActive: true },
      select: { id: true, fullName: true },
    });
  }

  /**
   * Downloads a WhatsApp media item and puts it on ImageKit.
   *
   * Two hops, both needing the access token: Meta gives a short-lived URL for
   * a media id, and that URL itself is authenticated. Returns null rather
   * than throwing — a photo that will not download should cost that photo,
   * not the whole message.
   */
  private async storeMedia(mediaId: string): Promise<string | null> {
    if (!this.accessToken || !this.imagekitPrivateKey) {
      this.logger.warn('Cannot store WhatsApp media: WHATSAPP_ACCESS_TOKEN or IMAGEKIT_PRIVATE_KEY unset');
      return null;
    }
    try {
      const metaRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!metaRes.ok) throw new Error(`media lookup ${metaRes.status}`);
      const { url, mime_type: mimeType } = await metaRes.json();

      const fileRes = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
      if (!fileRes.ok) throw new Error(`media download ${fileRes.status}`);
      const bytes = Buffer.from(await fileRes.arrayBuffer());

      // ImageKit's upload API: basic auth, private key as the username.
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType ?? 'image/jpeg' }), `${mediaId}.jpg`);
      form.append('fileName', `${mediaId}.jpg`);
      form.append('folder', '/rooms');
      // Room photos are public once the listing is — unlike verification
      // documents, which upload with isPrivateFile.
      form.append('useUniqueFileName', 'true');

      const uploadRes = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${this.imagekitPrivateKey}:`).toString('base64')}` },
        body: form,
      });
      if (!uploadRes.ok) throw new Error(`imagekit ${uploadRes.status} ${(await uploadRes.text()).slice(0, 200)}`);
      const { filePath } = await uploadRes.json();
      return filePath ?? null;
    } catch (err) {
      this.logger.error(`WhatsApp media ${mediaId} failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** The live draft for this landlord, or a new one. */
  private async openDraft(landlordId: string, fromNumber: string) {
    const existing = await this.prisma.whatsappDraft.findFirst({
      where: { landlordId, status: { in: ['collecting', 'ready'] } },
      orderBy: { lastMessageAt: 'desc' },
    });
    if (existing) return existing;
    return this.prisma.whatsappDraft.create({ data: { landlordId, fromNumber } });
  }

  /**
   * Resolves a place name against the Place taxonomy.
   *
   * The taxonomy is the only thing that knows what a South African place is
   * actually called, aliases included — "PE" for Gqeberha, "Joburg" for
   * Johannesburg.
   *
   * Matched on NAME, not slug. Suburb slugs are prefixed with their city
   * (`ekurhuleni-tembisa`, `johannesburg-sandton`), so looking words up
   * against the slug column matches cities and provinces and never once
   * matches a suburb — which is the level landlords actually write. The first
   * end-to-end run caught it: "en suite room in Tembisa" resolved to nothing.
   *
   * Whole-phrase containment rather than word-by-word, because plenty of real
   * names are two words — Green Point, Cape Town, Port Elizabeth — and a
   * per-word match would find "Point" or miss them entirely. Longest match
   * wins so "Cape Town" beats "Cape", then narrowest type wins so a named
   * suburb beats the city it sits in.
   */
  private placeCache: { name: string; aliases: string[]; type: string; city: string | null; province: string }[] | null = null;

  private async allPlaces() {
    // Static reference data — roughly 112 rows, seeded, never edited at
    // runtime. Loaded once rather than queried per inbound message.
    if (!this.placeCache) {
      this.placeCache = await this.prisma.place.findMany({
        select: { name: true, aliases: true, type: true, city: true, province: true },
      });
    }
    return this.placeCache;
  }

  private async matchPlace(text: string) {
    const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;
    const places = await this.allPlaces();

    const hits: { place: (typeof places)[number]; length: number }[] = [];
    for (const place of places) {
      for (const candidate of [place.name, ...place.aliases]) {
        const needle = ` ${candidate.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;
        if (needle.trim().length >= 3 && haystack.includes(needle)) {
          hits.push({ place, length: needle.trim().length });
          break;
        }
      }
    }
    if (hits.length === 0) return null;

    const rank = (t: string) => (t === 'suburb' ? 0 : t === 'city' ? 1 : 2);
    hits.sort((a, b) => rank(a.place.type) - rank(b.place.type) || b.length - a.length);
    return hits[0].place;
  }

  /**
   * One inbound message from a landlord.
   *
   * Returns the reply to send, or null to stay silent. Staying silent
   * matters: an unrecognised number gets one explanation and nothing after
   * that, so the bot cannot be turned into a way to send strangers messages.
   */
  async handleMessage(waId: string, message: InboundMessage): Promise<string | null> {
    const landlord = await this.landlordFor(waId);
    if (!landlord) {
      // Not a known landlord. Reply once — they may be a landlord whose
      // number is not verified yet, and silence would be baffling.
      return (
        `This number does not match a verified Mastande landlord account.\n\n` +
        `Sign in at ${this.frontendUrl}, add this number to your profile and verify it, ` +
        `then send your photos again.`
      );
    }

    const draft = await this.openDraft(landlord.id, waId);
    const update: Prisma.WhatsappDraftUpdateInput = { lastMessageAt: new Date() };

    const text: string | undefined = message.text?.body ?? message.image?.caption;
    const isDone = !!text && /^\s*(done|finish|finished|publish|ready)\s*$/i.test(text);

    if (message.type === 'image' && message.image?.id) {
      if (draft.imagePaths.length >= MAX_PHOTOS) {
        return `That is ${MAX_PHOTOS} photos already, which is the most a listing can have. Send DONE when you are ready.`;
      }
      const path = await this.storeMedia(message.image.id);
      if (!path) {
        return 'That photo did not come through. Please try sending it again.';
      }
      update.imagePaths = { set: [...draft.imagePaths, path] };
    } else if (message.type && message.type !== 'text') {
      // Voice notes, documents, locations. Answered rather than ignored so a
      // landlord who sends one is not left wondering.
      return (
        `Thank you — right now I can only read photos and typed messages.\n\n` +
        `Please type the details: what kind of room, where it is, and the rent.`
      );
    }

    if (text && !isDone) {
      const combined = [draft.rawText, text].filter(Boolean).join('\n');
      update.rawText = sanitizeText(combined);

      const rent = parseRent(combined);
      if (rent) update.parsedRentCents = rent;
      const roomType = parseRoomType(combined);
      if (roomType) update.parsedRoomType = roomType as RoomType;

      const place = await this.matchPlace(combined);
      if (place) {
        update.parsedProvince = place.province;
        update.parsedCity = place.city ?? place.name;
        if (place.type === 'suburb') update.parsedSuburb = place.name;
      }

      const title = buildTitle(
        { rentCents: rent, roomType, locationHint: null },
        (update.parsedSuburb as string) ?? (update.parsedCity as string) ?? null,
      );
      if (title) update.parsedTitle = title;
    }

    if (isDone) update.status = 'ready';

    const saved = await this.prisma.whatsappDraft.update({ where: { id: draft.id }, data: update });
    return this.replyFor(saved, landlord.fullName, isDone);
  }

  /**
   * What to say back.
   *
   * Says what was understood and what is still missing, because a landlord
   * who sends three photos into silence assumes it is broken. Short: this is
   * WhatsApp on a phone, not a form.
   */
  private replyFor(draft: { imagePaths: string[]; parsedRentCents: number | null; parsedRoomType: RoomType | null; parsedSuburb: string | null; parsedCity: string | null }, name: string, done?: boolean): string {
    const have: string[] = [];
    const missing: string[] = [];

    if (draft.imagePaths.length) have.push(`${draft.imagePaths.length} photo${draft.imagePaths.length === 1 ? '' : 's'}`);
    else missing.push('a photo');

    if (draft.parsedRentCents) have.push(`R${(draft.parsedRentCents / 100).toFixed(0)} a month`);
    else missing.push('the rent');

    const where = draft.parsedSuburb ?? draft.parsedCity;
    if (where) have.push(where);
    else missing.push('where it is');

    if (draft.parsedRoomType) have.push(draft.parsedRoomType.replace('_', ' '));

    if (done) {
      return (
        `Thanks ${name.split(' ')[0]}. I have ${have.join(', ') || 'your message'}.\n\n` +
        `Open ${this.frontendUrl}/landlord/dashboard to check it and publish. ` +
        `Nothing goes on the board until you do.`
      );
    }

    const gotLine = have.length ? `Got: ${have.join(', ')}.` : 'Got your message.';
    const needLine = missing.length ? `\nStill need: ${missing.join(', ')}.` : '';
    return `${gotLine}${needLine}\n\nSend more photos or details, or reply DONE when finished.`;
  }

  /**
   * Turns a draft into a Room the landlord can finish and publish.
   *
   * Everything unparsed is left blank rather than defaulted, except the two
   * fields Room cannot be created without — availability, which becomes today
   * and is the first thing on the wizard's screen, and a title, which falls
   * back to something obviously provisional. A silent default is a wrong
   * value a landlord never notices; a blank is a question they answer.
   */
  async claim(draftId: string, landlordId: string) {
    const draft = await this.prisma.whatsappDraft.findUnique({ where: { id: draftId } });
    if (!draft || draft.landlordId !== landlordId) return null;
    if (draft.roomId) return { roomId: draft.roomId, alreadyClaimed: true };

    const room = await this.prisma.$transaction(async (tx) => {
      const created = await tx.room.create({
        data: {
          landlordId,
          title: draft.parsedTitle ?? 'Room from WhatsApp — add a title',
          roomType: draft.parsedRoomType ?? 'private',
          rentCents: draft.parsedRentCents ?? 0,
          province: draft.parsedProvince ?? '',
          city: draft.parsedCity ?? '',
          locationDisplay: [draft.parsedSuburb, draft.parsedCity].filter(Boolean).join(', '),
          availableFrom: new Date(),
          description: draft.rawText,
          heroImagePath: draft.imagePaths[0] ?? null,
          imagePaths: draft.imagePaths,
          status: 'draft',
        },
      });
      await tx.whatsappDraft.update({
        where: { id: draftId },
        data: { status: 'claimed', roomId: created.id },
      });
      return created;
    });

    this.logger.log(`WhatsApp draft ${draftId} claimed as room ${room.id}`);
    return { roomId: room.id, alreadyClaimed: false };
  }

  /** Drafts waiting for this landlord on the web. */
  pending(landlordId: string) {
    return this.prisma.whatsappDraft.findMany({
      where: { landlordId, status: { in: ['collecting', 'ready'] } },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  /**
   * Retires conversations that went quiet.
   *
   * Marked abandoned, never deleted: a landlord who comes back after three
   * weeks should be told their draft is stale, not that their photos are
   * gone.
   */
  @Cron('30 3 * * *', { timeZone: 'Africa/Johannesburg' })
  async abandonStale() {
    const cutoff = new Date(Date.now() - ABANDON_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.whatsappDraft.updateMany({
      where: { status: { in: ['collecting', 'ready'] }, lastMessageAt: { lt: cutoff } },
      data: { status: 'abandoned' },
    });
    if (count) this.logger.log(`Abandoned ${count} stale WhatsApp draft(s)`);
    return { abandoned: count };
  }
}
