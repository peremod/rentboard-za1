import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ServiceCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normaliseSaMobile } from '../../common/utils/phone.util';
import { CreateServiceProviderDto, UpdateServiceProviderDto } from './dto/service-provider.dto';

/**
 * The people a landlord phones when something breaks.
 *
 * Admin-curated: there is no landlord-facing way to add one. See the schema
 * note for why — recommending a stranger to someone's tenants is a risk the
 * platform would be taking on with no way to manage it.
 */
/** Did this request touch any of the checks? Decides whether lastCheckedAt moves. */
function anyCheck(dto: {
  phoneConfirmedAt?: string | null;
  idCheckedAt?: string | null;
  referenceCheckedAt?: string | null;
  tradeRegistration?: string | null;
}): boolean {
  return dto.phoneConfirmedAt !== undefined
    || dto.idCheckedAt !== undefined
    || dto.referenceCheckedAt !== undefined
    || dto.tradeRegistration !== undefined;
}

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}

  /**
   * One canonical number, via the shared helper.
   *
   * Not a second copy of the regex: storing two forms of one number is the
   * defect phone.util.ts was written for, and a directory listing the same
   * plumber twice is that defect with a user-visible face.
   */
  private phoneOrThrow(raw: string): string {
    const normalised = normaliseSaMobile(raw);
    if (!normalised) {
      throw new BadRequestException(
        'That does not look like a South African mobile number. Use 082 123 4567 or +27821234567.',
      );
    }
    return normalised;
  }

  /**
   * What a landlord sees: active providers only, newest last within a category.
   *
   * `area` narrows by coverage when given. Matched case-insensitively against
   * the free-text areas, because an admin typing "Tembisa" and a landlord in
   * "tembisa" are looking for each other.
   */
  async listForLandlord(category?: ServiceCategory, area?: string) {
    const where: Prisma.ServiceProviderWhereInput = { active: true };
    if (category) where.category = category;
    if (area?.trim()) where.areas = { has: area.trim() };

    const exact = await this.ordered(where);
    if (exact.length || !area?.trim()) return exact;

    // `has` is exact and case-sensitive. Rather than return nothing to a
    // landlord in "tembisa" when the admin typed "Tembisa", fall back to a
    // case-insensitive pass in memory — the table is a curated list of tens,
    // not thousands, so this is cheaper than the index it would otherwise need.
    const all = await this.ordered({ active: true, ...(category ? { category } : {}) });
    const needle = area.trim().toLowerCase();
    return all.filter((p) => p.areas.some((a) => a.toLowerCase() === needle));
  }

  /**
   * The one place the list order is decided.
   *
   * By category then name. Note that Prisma orders an enum by its DECLARATION
   * order, not alphabetically, so this yields plumber, electrician, locksmith,
   * cleaner, other — which is the order the enum was written in and a better
   * one than alphabetical: a plumber is what a landlord needs most often.
   * Worth stating because it is not obvious, and a drive asserting alphabetical
   * order called the correct behaviour a failure.
   *
   * Deliberately NOT ordered by `sponsoredUntil`. That column
   * exists for a future paid placement and nothing reads it yet; putting it in
   * the ORDER BY now would quietly make the directory an advertising surface
   * before anyone has decided it should be one, and the first paid entry would
   * jump the queue with no label saying why.
   */
  private ordered(where: Prisma.ServiceProviderWhereInput) {
    return this.prisma.serviceProvider.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      /**
       * ⚠️ An explicit SELECT, so `checkedByAdminId` cannot reach a landlord.
       *
       * Which admin signed off a tradesperson is for accountability, not for
       * the directory. It was never in a payload because the column did not
       * exist; now it does, and a bare findMany would have started shipping it
       * the moment it was added. The same reasoning as the verification
       * endpoint withholding documentPath.
       */
      select: {
        id: true, category: true, name: true, phone: true, whatsapp: true,
        areas: true, note: true, active: true, sponsoredUntil: true, createdAt: true,
        // The checks, which are the whole point of the screen's claim.
        phoneConfirmedAt: true, idCheckedAt: true, referenceCheckedAt: true,
        tradeRegistration: true, lastCheckedAt: true,
      },
    });
  }

  /** Everything, including inactive — admin only. */
  listAll() {
    return this.prisma.serviceProvider.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * A provider is listed only once somebody has rung the number — Phase 7j.
   *
   * ⚠️ The screen says "people we have checked out". Until this phase nothing
   * recorded a check of any kind, so that sentence was a claim the data could
   * not support — on the one axis this product competes on, and in the place a
   * landlord decides whether to let a stranger into their tenant's room.
   *
   * Reaching the person on the number is the minimum that makes "we can pass
   * this on" true. Enforced here AND as a CHECK constraint, because the rule
   * matters more than the route: a direct UPDATE, a seed script or a second
   * admin surface must not be able to publish an unchecked name.
   */
  private assertPublishable(
    active: boolean | undefined,
    phoneConfirmedAt: Date | null | undefined,
  ) {
    if (active && !phoneConfirmedAt) {
      throw new BadRequestException(
        'Ring the number and confirm you reached them before listing this person. '
        + 'The directory tells landlords we have checked these names.',
      );
    }
  }

  async create(dto: CreateServiceProviderDto, adminId?: string) {
    const phoneConfirmedAt = dto.phoneConfirmedAt ? new Date(dto.phoneConfirmedAt) : null;
    this.assertPublishable(dto.active, phoneConfirmedAt);
    return this.prisma.serviceProvider.create({
      data: {
        category: dto.category,
        name: dto.name.trim(),
        phone: this.phoneOrThrow(dto.phone),
        whatsapp: dto.whatsapp ?? true,
        areas: dto.areas.map((a) => a.trim()).filter(Boolean),
        note: dto.note?.trim() || null,
        active: dto.active ?? false,
        sponsoredUntil: dto.sponsoredUntil ? new Date(dto.sponsoredUntil) : null,
        phoneConfirmedAt,
        idCheckedAt: dto.idCheckedAt ? new Date(dto.idCheckedAt) : null,
        referenceCheckedAt: dto.referenceCheckedAt ? new Date(dto.referenceCheckedAt) : null,
        tradeRegistration: dto.tradeRegistration?.trim() || null,
        lastCheckedAt: anyCheck(dto) ? new Date() : null,
        // Accountability only; never in a landlord-facing payload.
        checkedByAdminId: anyCheck(dto) ? (adminId ?? null) : null,
      },
    });
  }

  async update(id: string, dto: UpdateServiceProviderDto, adminId?: string) {
    const existing = await this.prisma.serviceProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('No such service provider');

    const data: Prisma.ServiceProviderUpdateInput = {};
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = this.phoneOrThrow(dto.phone);
    if (dto.whatsapp !== undefined) data.whatsapp = dto.whatsapp;
    if (dto.areas !== undefined) data.areas = dto.areas.map((a) => a.trim()).filter(Boolean);
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.sponsoredUntil !== undefined) {
      data.sponsoredUntil = dto.sponsoredUntil ? new Date(dto.sponsoredUntil) : null;
    }

    // ── The checks — Phase 7j ───────────────────────────────────────────────
    if (dto.phoneConfirmedAt !== undefined) {
      data.phoneConfirmedAt = dto.phoneConfirmedAt ? new Date(dto.phoneConfirmedAt) : null;
    }
    if (dto.idCheckedAt !== undefined) {
      data.idCheckedAt = dto.idCheckedAt ? new Date(dto.idCheckedAt) : null;
    }
    if (dto.referenceCheckedAt !== undefined) {
      data.referenceCheckedAt = dto.referenceCheckedAt ? new Date(dto.referenceCheckedAt) : null;
    }
    if (dto.tradeRegistration !== undefined) {
      data.tradeRegistration = dto.tradeRegistration?.trim() || null;
    }
    if (anyCheck(dto)) {
      data.lastCheckedAt = new Date();
      data.checkedByAdminId = adminId ?? null;
    }

    /**
     * ⚠️ Checked against what the row will BE, not against the request.
     *
     * `{ active: true }` with no phone field in the body is the common case —
     * an admin ticking "list this person" on a row that already has the check.
     * Reading only the DTO would refuse that, and reading only the row would
     * wave through `{ active: true, phoneConfirmedAt: null }`, which clears the
     * check and publishes in one call. Both have to be considered together.
     */
    const effectiveActive = dto.active !== undefined ? dto.active : existing.active;
    const effectivePhoneCheck = dto.phoneConfirmedAt !== undefined
      ? (dto.phoneConfirmedAt ? new Date(dto.phoneConfirmedAt) : null)
      : existing.phoneConfirmedAt;
    this.assertPublishable(effectiveActive, effectivePhoneCheck);

    return this.prisma.serviceProvider.update({ where: { id }, data });
  }

  async remove(id: string) {
    const existing = await this.prisma.serviceProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('No such service provider');
    await this.prisma.serviceProvider.delete({ where: { id } });
    return { deleted: true };
  }
}
