import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

/**
 * What a landlord spends, per yard.
 *
 * The other half of the money picture. Rent tracking already says what came
 * in; without this, "how am I doing" is a question the product can only half
 * answer, and half an answer about money is worse than none.
 */
@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(private prisma: PrismaService) {}

  /** A yard the caller owns, or an exception naming which problem it is. */
  private async assertOwnsProperty(propertyId: string, landlordId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, landlordId: true },
    });
    if (!property) throw new NotFoundException('No such property');
    if (property.landlordId !== landlordId) throw new ForbiddenException('That is not your property');
    return property;
  }

  /**
   * A room may only be attached to an expense on the yard it is actually in.
   *
   * Without this a landlord could file a cost against room A while the expense
   * sits on yard B, and every per-room figure afterwards would be quietly
   * wrong in a way no screen could show them.
   */
  private async assertRoomInProperty(roomId: string, propertyId: string, landlordId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, landlordId: true, propertyId: true },
    });
    if (!room) throw new NotFoundException('No such room');
    if (room.landlordId !== landlordId) throw new ForbiddenException('That is not your room');
    if (room.propertyId !== propertyId) {
      throw new ForbiddenException('That room is not in this yard.');
    }
  }

  async create(dto: CreateExpenseDto, landlordId: string) {
    await this.assertOwnsProperty(dto.propertyId, landlordId);
    if (dto.roomId) await this.assertRoomInProperty(dto.roomId, dto.propertyId, landlordId);

    return this.prisma.expense.create({
      data: {
        landlordId,
        propertyId: dto.propertyId,
        roomId: dto.roomId ?? null,
        category: dto.category,
        amountCents: dto.amountCents,
        incurredOn: new Date(dto.incurredOn),
        receiptPath: dto.receiptPath ?? null,
        note: dto.note ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateExpenseDto, landlordId: string) {
    const existing = await this.prisma.expense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('No such expense');
    if (existing.landlordId !== landlordId) throw new ForbiddenException('That is not your expense');

    const propertyId = dto.propertyId ?? existing.propertyId;
    if (dto.propertyId) await this.assertOwnsProperty(dto.propertyId, landlordId);

    // Checked against the property it will END UP on, not the one it is on
    // now. Moving an expense to another yard while keeping a room from the old
    // one is exactly the inconsistency this guards.
    const roomId = dto.roomId === undefined ? existing.roomId : dto.roomId;
    if (roomId) await this.assertRoomInProperty(roomId, propertyId, landlordId);

    const data: Prisma.ExpenseUpdateInput = {};
    if (dto.propertyId) data.property = { connect: { id: dto.propertyId } };
    // `undefined` means "not sent"; `null` means "clear it". Collapsing the two
    // would make it impossible to detach a room once attached.
    if (dto.roomId !== undefined) {
      data.room = dto.roomId ? { connect: { id: dto.roomId } } : { disconnect: true };
    }
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.amountCents !== undefined) data.amountCents = dto.amountCents;
    if (dto.incurredOn !== undefined) data.incurredOn = new Date(dto.incurredOn);
    if (dto.receiptPath !== undefined) data.receiptPath = dto.receiptPath;
    if (dto.note !== undefined) data.note = dto.note;

    return this.prisma.expense.update({ where: { id }, data });
  }

  async remove(id: string, landlordId: string) {
    const existing = await this.prisma.expense.findUnique({ where: { id }, select: { landlordId: true } });
    if (!existing) throw new NotFoundException('No such expense');
    if (existing.landlordId !== landlordId) throw new ForbiddenException('That is not your expense');
    await this.prisma.expense.delete({ where: { id } });
    return { deleted: true };
  }

  /** One yard's expenses, newest spend first. */
  list(propertyId: string, landlordId: string) {
    return this.assertOwnsProperty(propertyId, landlordId).then(() =>
      this.prisma.expense.findMany({
        where: { propertyId, landlordId },
        orderBy: { incurredOn: 'desc' },
        include: { room: { select: { id: true, title: true } } },
      }),
    );
  }

  /**
   * Rent in, expenses out, for one month, per yard and for the portfolio.
   *
   * ── What "rent collected" counts, and what it does not
   *
   * Only periods the landlord has marked `paid`. NOT `partial`, because the
   * platform does not know how much of a partial payment arrived — the model
   * stores the month's full amount and the fact that some of it came — and
   * counting the full amount would overstate income on exactly the months a
   * landlord most needs the real number. NOT `waived` either: nothing arrived.
   *
   * This is stated on the screen too. A money figure whose rules are invisible
   * is a figure someone will plan around and be wrong about.
   */
  async monthlySummary(landlordId: string, month: string) {
    // `month` is YYYY-MM. Normalised to midnight UTC on the first, matching
    // how RentPeriod.periodStart is stored, or the join silently misses rows
    // by a timezone offset.
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, mon - 1, 1));
    const end = new Date(Date.UTC(year, mon, 1));

    const [properties, expenses, paidPeriods] = await Promise.all([
      this.prisma.property.findMany({
        where: { landlordId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.expense.findMany({
        where: { landlordId, incurredOn: { gte: start, lt: end } },
        select: { propertyId: true, amountCents: true, category: true },
      }),
      this.prisma.rentPeriod.findMany({
        where: {
          periodStart: start,
          status: 'paid',
          tenancy: { landlordId },
        },
        select: { amountCents: true, tenancy: { select: { room: { select: { propertyId: true } } } } },
      }),
    ]);

    const byProperty = new Map<string, { rentCents: number; expenseCents: number }>();
    const ensure = (id: string) => {
      if (!byProperty.has(id)) byProperty.set(id, { rentCents: 0, expenseCents: 0 });
      return byProperty.get(id)!;
    };

    for (const e of expenses) ensure(e.propertyId).expenseCents += e.amountCents;

    /** Rent on a room that is in no yard. Reported, never silently dropped. */
    let ungroupedRentCents = 0;
    for (const p of paidPeriods) {
      const pid = p.tenancy.room.propertyId;
      if (pid) ensure(pid).rentCents += p.amountCents;
      else ungroupedRentCents += p.amountCents;
    }

    const byCategory: Record<string, number> = {};
    for (const e of expenses) byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amountCents;

    const rows = properties.map((prop) => {
      const t = byProperty.get(prop.id) ?? { rentCents: 0, expenseCents: 0 };
      return {
        propertyId: prop.id,
        name: prop.name,
        rentCents: t.rentCents,
        expenseCents: t.expenseCents,
        netCents: t.rentCents - t.expenseCents,
      };
    });

    const totalRent = rows.reduce((s, r) => s + r.rentCents, 0) + ungroupedRentCents;
    const totalExpense = rows.reduce((s, r) => s + r.expenseCents, 0);

    return {
      month,
      properties: rows,
      ungroupedRentCents,
      totalRentCents: totalRent,
      totalExpenseCents: totalExpense,
      netCents: totalRent - totalExpense,
      byCategory,
      /** Said out loud so the number cannot be misread — see the doc comment. */
      rentBasis: 'Only months you marked paid. Partial and waived months are not counted.',
    };
  }

  /**
   * A year of one yard's expenses as CSV, for SARS.
   *
   * Not a tax report and does not pretend to be: it is the rows, with the
   * columns an accountant asks for. Anything that computed a deduction would
   * be advice this product is not qualified to give.
   */
  async yearCsv(propertyId: string, year: number, landlordId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, name: true, landlordId: true },
    });
    if (!property) throw new NotFoundException('No such property');
    if (property.landlordId !== landlordId) throw new ForbiddenException('That is not your property');

    const rows = await this.prisma.expense.findMany({
      where: {
        propertyId,
        landlordId,
        incurredOn: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      orderBy: { incurredOn: 'asc' },
      include: { room: { select: { title: true } } },
    });

    // Quote every field and double internal quotes. A note saying
    // `Plumber, after hours` would otherwise become two columns and shift
    // every figure on that line one place left.
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ['Date', 'Category', 'Room', 'Amount (R)', 'Note'].map(esc).join(','),
      ...rows.map((r) =>
        [
          r.incurredOn.toISOString().slice(0, 10),
          r.category,
          r.room?.title ?? '',
          (r.amountCents / 100).toFixed(2),
          r.note ?? '',
        ]
          .map((v) => esc(String(v)))
          .join(','),
      ),
    ];

    return {
      filename: `expenses-${property.name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-${year}.csv`,
      csv: lines.join('\n') + '\n',
      count: rows.length,
    };
  }
}
