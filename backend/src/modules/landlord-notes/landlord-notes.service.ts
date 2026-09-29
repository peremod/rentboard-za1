import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Private notes a landlord keeps about a tenant — Phase 5e.
 *
 * ── Every read is scoped by the author, in the WHERE clause
 *
 * Not fetched and then checked: `landlordId` is a condition on every query here,
 * so there is no code path that loads somebody else's note into memory at all.
 * A permission check after the fact is one refactor away from being dropped; a
 * query that cannot return the row is not.
 *
 * ── Why there is no "notes about me" endpoint
 *
 * A tenant cannot read notes written about them through the API, and that is
 * deliberate rather than an omission. Under POPIA s.23 they have a right of
 * access, but the right is against the RESPONSIBLE PARTY — the landlord — and
 * satisfying it through a self-service endpoint would turn a private memory aid
 * into a channel for arguing with it. The access path is admin-assisted and
 * logged, like the rest of the subject-request handling.
 *
 * ── What this must never become
 *
 * No score, no stars, no flag, nothing structured. A private rating collected
 * across landlords is a shadow credit score assembled from opinions, which is
 * exactly what Phase 1 rejected the bureau check in favour of avoiding. Nothing
 * here feeds reviews, the Tenant Passport, or the landlord-reference flow — that
 * flow is a separate, consented exchange where a previous landlord knowingly
 * answers a specific question.
 */
@Injectable()
export class LandlordNotesService {
  constructor(private prisma: PrismaService) {}

  /**
   * This landlord's notes about one tenant, newest first.
   *
   * Returns an empty list rather than 404 for a tenant they have never noted:
   * a 404 would confirm whether that user exists, and the caller has a tenant id
   * they may have got from anywhere.
   */
  list(landlordId: string, tenantId: string) {
    return this.prisma.landlordNote.findMany({
      where: { landlordId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Every note this landlord has written, grouped by who it is about.
   *
   * For a "my notes" screen. Carries the tenant's name so the list is navigable
   * without a second round trip per note.
   */
  async listAll(landlordId: string) {
    const notes = await this.prisma.landlordNote.findMany({
      where: { landlordId },
      orderBy: { createdAt: 'desc' },
      include: { tenant: { select: { id: true, fullName: true } } },
      take: 500,
    });
    // Grouped here rather than in the browser: the screen wants "one card per
    // person", and two places deriving that grouping is two places to disagree.
    const byTenant = new Map<string, { tenantId: string; tenantName: string; notes: typeof notes }>();
    for (const n of notes) {
      const existing = byTenant.get(n.tenantId);
      if (existing) existing.notes.push(n);
      else byTenant.set(n.tenantId, { tenantId: n.tenantId, tenantName: n.tenant.fullName, notes: [n] });
    }
    return [...byTenant.values()];
  }

  /**
   * Write a note.
   *
   * The tenant must be someone this landlord has actually dealt with — somebody
   * who applied to one of their rooms, or has a tenancy with them. Without that
   * check the endpoint is a way to write a private dossier on any user id you can
   * guess, which is a different product from a memory aid about your own
   * applicants.
   */
  async create(landlordId: string, tenantId: string, body: string) {
    const known = await this.hasDealtWith(landlordId, tenantId);
    if (!known) {
      throw new ForbiddenException(
        'You can only keep notes about people who have applied to one of your rooms or rented from you.',
      );
    }
    return this.prisma.landlordNote.create({
      data: { landlordId, tenantId, body: body.trim() },
    });
  }

  /** Has this tenant applied to, or rented, one of this landlord's rooms? */
  private async hasDealtWith(landlordId: string, tenantId: string): Promise<boolean> {
    // Archived applications count: a landlord who took notes during a letting
    // cycle that has since been relisted still dealt with that person.
    const [application, tenancy] = await Promise.all([
      this.prisma.application.findFirst({
        where: { tenantId, room: { landlordId } },
        select: { id: true },
      }),
      this.prisma.tenancy.findFirst({
        where: { tenantId, landlordId },
        select: { id: true },
      }),
    ]);
    return Boolean(application || tenancy);
  }

  /** Edit your own note. The author is part of the WHERE, not a later check. */
  async update(landlordId: string, id: string, body: string) {
    const result = await this.prisma.landlordNote.updateMany({
      where: { id, landlordId },
      data: { body: body.trim() },
    });
    // updateMany rather than update, so a note belonging to someone else is a
    // miss rather than a row we loaded and then refused. 404, not 403: a 403
    // would confirm the note exists.
    if (result.count === 0) throw new NotFoundException('Note not found');
    return this.prisma.landlordNote.findUnique({ where: { id } });
  }

  async remove(landlordId: string, id: string) {
    const result = await this.prisma.landlordNote.deleteMany({ where: { id, landlordId } });
    if (result.count === 0) throw new NotFoundException('Note not found');
    return { deleted: true as const };
  }
}
