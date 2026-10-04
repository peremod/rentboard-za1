import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ContractorLeadChannel, ServiceCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Leads sent to a contractor, and what they would come to — Phase 7k.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️  THIS SERVICE DOES NOT TAKE MONEY, AND THAT IS NOT AN OVERSIGHT
 * ═════════════════════════════════════════════════════════════════════════
 *
 * A contractor is not a user. `ServiceProvider` has no `userId` and no email —
 * a name, a phone number and the areas they cover. They cannot sign in, cannot
 * see a bill, cannot accept terms and cannot dispute a charge in this product.
 *
 * So this keeps the RECORD: what we passed on, to whom, on what day, and what
 * it comes to at a rate somebody agreed. Invoicing and collection happen
 * outside the product, by a person, from this record. Making the product
 * collect needs contractor accounts first — a portal, terms acceptance, a bill
 * they can read and a way to disagree with it — which is a product decision,
 * not a service method.
 *
 * It does not touch "free to list, free to apply": the money would come from a
 * contractor receiving leads, a third party, never from a landlord listing a
 * room or a tenant applying for one.
 *
 * ── There is no price in this file
 *
 * Not a constant, not a default, not a fallback. The rate is read from
 * `contractor_lead_rates`, which ships empty. With no rate configured a lead is
 * recorded with no fee and `billable: false` — the product counts what it sent
 * and declines to put a figure on it, which is the honest state of a price
 * nobody has decided.
 */
@Injectable()
export class ContractorLeadsService {
  private readonly log = new Logger(ContractorLeadsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * The rate in force for a category at a moment.
   *
   * Rates are effective-dated and never edited: a new row supersedes an older
   * one and the old one stays, because leads point at the rate they were
   * created under. So "in force" is the latest row whose `effectiveFrom` is not
   * in the future — and a rate dated next month is deliberately not used yet.
   */
  private rateFor(category: ServiceCategory, at: Date) {
    return this.prisma.contractorLeadRate.findFirst({
      where: { category, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * Record that a landlord was handed this contractor's number.
   *
   * ── Deduplicated per landlord per day
   *
   * A landlord tapping "call" five times while the phone rings is one lead, not
   * five. Enforced by a unique index rather than a read-then-write, because two
   * taps in the same second would both see nothing and both insert.
   *
   * The first tap of the day wins, including its channel: a landlord who rings
   * and then tries WhatsApp has made one approach, and recording the second as
   * a separate lead would bill twice for one introduction.
   */
  async record(
    providerId: string,
    landlordId: string,
    channel: ContractorLeadChannel,
  ) {
    const provider = await this.prisma.serviceProvider.findUnique({
      where: { id: providerId },
      select: { id: true, category: true, active: true, leadFeesAgreedAt: true },
    });
    if (!provider) throw new NotFoundException('No such service provider');

    /**
     * ⚠️ Only a listed provider generates a lead.
     *
     * A landlord cannot see an unlisted one, so a lead against one could only
     * arrive from a stale page or a hand-written request — and billing somebody
     * for an introduction the directory was not making is indefensible.
     */
    if (!provider.active) {
      throw new BadRequestException('That person is not currently listed.');
    }

    const now = new Date();
    const leadDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    /**
     * Billable only if BOTH hold: they agreed to pay for leads, and a rate
     * existed at the time. Either missing means we counted it and put no
     * number on it.
     *
     * ⚠️ The fee is SNAPSHOTTED here. A price change next month must not
     * silently re-price what was already sent, and somebody agreeing terms in
     * November must not make October's leads billable retrospectively — which
     * is why `billable` is stored rather than derived on read.
     */
    const rate = provider.leadFeesAgreedAt ? await this.rateFor(provider.category, now) : null;

    const created = await this.prisma.contractorLead.upsert({
      where: {
        providerId_landlordId_leadDay: { providerId, landlordId, leadDay },
      },
      // Already approached today: leave the first one exactly as it is.
      update: {},
      create: {
        providerId,
        landlordId,
        channel,
        leadDay,
        feeCents: rate?.amountCents ?? null,
        rateId: rate?.id ?? null,
        billable: !!rate,
      },
    });

    return { recorded: true, leadId: created.id, firstToday: created.createdAt >= now };
  }

  /**
   * What each contractor was sent, and what it comes to — the admin view.
   *
   * ⚠️ This is a RECORD, not an invoice. Nothing here has been billed, nothing
   * has been paid, and the product has no way to do either: the figure is what
   * the leads come to at the rate that was in force, for a person to invoice
   * outside the product. The screen says so, and so does this.
   */
  async summary(opts: { from?: Date; to?: Date } = {}) {
    const where = {
      ...(opts.from || opts.to
        ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
    };

    const providers = await this.prisma.serviceProvider.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true, category: true, active: true,
        leadFeesAgreedAt: true, leadFeesNote: true,
      },
    });

    const grouped = await this.prisma.contractorLead.groupBy({
      by: ['providerId', 'billable'],
      where,
      _count: { _all: true },
      _sum: { feeCents: true },
    });

    const rates = await this.prisma.contractorLeadRate.findMany({
      orderBy: { effectiveFrom: 'desc' },
    });

    const rows = providers.map((p) => {
      const mine = grouped.filter((g) => g.providerId === p.id);
      const billable = mine.find((g) => g.billable);
      const unbilled = mine.find((g) => !g.billable);
      return {
        provider: { id: p.id, name: p.name, category: p.category, active: p.active },
        agreedToLeadFees: !!p.leadFeesAgreedAt,
        agreementNote: p.leadFeesNote,
        leads: {
          billable: billable?._count._all ?? 0,
          /**
           * Counted and NOT priced — either they never agreed to lead fees or
           * no rate existed when the lead happened. Reported separately rather
           * than folded into the total, because "we sent you eleven and are
           * charging for four" is the honest sentence and a single number
           * hides which.
           */
          notBillable: unbilled?._count._all ?? 0,
        },
        /** Cents. What the billable leads come to. Nothing has been invoiced. */
        wouldOweCents: billable?._sum.feeCents ?? 0,
      };
    });

    return {
      /**
       * ⚠️ Stated in the payload, not only on the screen.
       *
       * Any future consumer of this endpoint — a report, an export, a second
       * admin surface — reads this field before it reads a number, so nothing
       * built on top of it can mistake the figure for an amount owed on an
       * invoice that exists.
       */
      disclaimer:
        'A record of leads sent, priced at the agreed rate. Nothing here has been '
        + 'invoiced or paid, and this product cannot do either: contractors have no '
        + 'account. Invoice outside the product from these figures.',
      rates: rates.map((r) => ({
        category: r.category,
        amountCents: r.amountCents,
        effectiveFrom: r.effectiveFrom,
        note: r.note,
      })),
      /** True when no rate has been configured at all — see the note above. */
      noRatesConfigured: rates.length === 0,
      rows,
    };
  }

  /**
   * Set a rate for a category, from a date.
   *
   * ⚠️ Insert-only. Rates are never edited and never deleted, because leads
   * point at the one they were created under: editing a rate would re-price
   * history, and deleting one would leave a lead claiming a figure from nowhere.
   * A new row supersedes the old.
   */
  async setRate(
    category: ServiceCategory,
    amountCents: number,
    effectiveFrom: Date,
    adminId: string,
    note?: string,
  ) {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new BadRequestException('A lead fee has to be a positive number of cents.');
    }
    const rate = await this.prisma.contractorLeadRate.create({
      data: { category, amountCents, effectiveFrom, note: note?.trim() || null, setByAdminId: adminId },
    });
    this.log.log(
      `Lead rate for ${category} set to ${amountCents}c from ${effectiveFrom.toISOString().slice(0, 10)} by admin ${adminId}`,
    );
    return rate;
  }

  /** Record that a contractor agreed to pay for leads, out of band. */
  async recordAgreement(providerId: string, note: string, adminId: string) {
    const trimmed = note?.trim();
    if (!trimmed || trimmed.length < 10) {
      throw new BadRequestException(
        'Record how they agreed — it is the only evidence, because they have no account to agree in.',
      );
    }
    const provider = await this.prisma.serviceProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundException('No such service provider');

    const updated = await this.prisma.serviceProvider.update({
      where: { id: providerId },
      data: { leadFeesAgreedAt: new Date(), leadFeesNote: trimmed },
    });
    this.log.log(`Lead fees agreed by provider ${providerId}, recorded by admin ${adminId}`);
    return { agreedAt: updated.leadFeesAgreedAt, note: updated.leadFeesNote };
  }
}
