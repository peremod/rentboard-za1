import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomFiltersDto } from './dto/room-filters.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RelistDto } from './dto/relist.dto';

/** Free plan: max 2 active rooms — enforced on create() and relist(). */
const FREE_PLAN_ROOM_LIMIT = 2;
/** Landlord can undo a mark-as-let within this window. */
const UNDO_LET_WINDOW_MINUTES = 30;

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  /** Public notice-board search — only ever returns status = 'active' rooms. */
  async findAll(filters: RoomFiltersDto) {
    const {
      search, roomType, province, city, maxRentCents, minRentCents,
      billsIncluded, couplesAllowed, dssAccepted, guarantorAccepted, petsAllowed,
      sortBy = 'newest', page = 1, limit = 12,
    } = filters;

    const where: any = {
      status: 'active',
      ...(roomType && { roomType }),
      ...(province && { province }),
      ...(city && { city: { contains: city, mode: 'insensitive' } }),
      ...(billsIncluded && { billsIncluded: true }),
      ...(couplesAllowed && { couplesAllowed: true }),
      ...(dssAccepted && { dssAccepted: true }),
      ...(guarantorAccepted && { guarantorAccepted: true }),
      ...(petsAllowed && { petsAllowed: true }),
      ...(maxRentCents && { rentCents: { lte: maxRentCents } }),
      ...(minRentCents && { rentCents: { gte: minRentCents } }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { locationDisplay: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const orderBy: any[] = [
      { isFeatured: 'desc' },
      ...(sortBy === 'price_asc' ? [{ rentCents: 'asc' }] : []),
      ...(sortBy === 'price_desc' ? [{ rentCents: 'desc' }] : []),
      ...(sortBy === 'newest' || sortBy === 'featured' ? [{ publishedAt: 'desc' }] : []),
    ];

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.room.findMany({ where, orderBy, skip, take: limit }),
      this.prisma.room.count({ where }),
    ]);

    return { data, total, page, limit, hasMore: skip + data.length < total };
  }

  /** Single room — increments viewCount fire-and-forget, never blocks the response. */
  async findOne(id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException(`Room ${id} not found`);

    this.prisma.room.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
    return room;
  }

  async create(dto: CreateRoomDto, landlordId: string) {
    await this.enforcePlanLimit(landlordId);
    return this.prisma.room.create({
      data: { ...dto, availableFrom: new Date(dto.availableFrom), landlordId, status: 'draft' },
    });
  }

  async update(id: string, dto: UpdateRoomDto, landlordId: string) {
    await this.assertOwner(id, landlordId);
    return this.prisma.room.update({
      where: { id },
      data: { ...dto, ...(dto.availableFrom && { availableFrom: new Date(dto.availableFrom) }) },
    });
  }

  /** Publish a draft — requires a cover photo and a real description first. */
  async publish(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (!room.heroImagePath) throw new BadRequestException('A cover photo is required before publishing');
    if (!room.description || room.description.length < 50) {
      throw new BadRequestException('Description must be at least 50 characters');
    }
    return this.prisma.room.update({ where: { id }, data: { status: 'active', publishedAt: new Date() } });
  }

  async markReserved(id: string, landlordId: string) {
    await this.assertOwner(id, landlordId);
    return this.prisma.room.update({ where: { id }, data: { status: 'reserved' } });
  }

  /** Removes the room from the public board and archives it for the landlord. */
  async markLet(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status !== 'active' && room.status !== 'reserved') {
      throw new BadRequestException(`Cannot mark a ${room.status} room as let`);
    }
    return this.prisma.room.update({ where: { id }, data: { status: 'let', letAt: new Date() } });
  }

  /** 30-minute undo window after markLet(). */
  async undoLet(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status !== 'let') throw new BadRequestException('This room has not been marked as let');

    const minutesSince = (Date.now() - (room.letAt?.getTime() ?? 0)) / 60000;
    if (minutesSince > UNDO_LET_WINDOW_MINUTES) {
      throw new BadRequestException(`Undo window has expired (${UNDO_LET_WINDOW_MINUTES} min). Please relist instead.`);
    }
    return this.prisma.room.update({ where: { id }, data: { status: 'active', letAt: null } });
  }

  /** One-click relist — restores an archived room to active, preserving all details. */
  async relist(id: string, dto: RelistDto, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status !== 'let' && room.status !== 'paused') {
      throw new BadRequestException('Only let or paused rooms can be relisted');
    }
    await this.enforcePlanLimit(landlordId);

    return this.prisma.room.update({
      where: { id },
      data: {
        status: 'active',
        rentCents: dto.rentCents ?? room.rentCents,
        availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : room.availableFrom,
        publishedAt: new Date(),
        letAt: null,
        relistCount: { increment: 1 },
      },
    });
  }

  getLandlordRooms(landlordId: string) {
    return this.prisma.room.findMany({
      where: { landlordId, status: { in: ['active', 'reserved', 'draft'] } },
      orderBy: { publishedAt: 'desc' },
    });
  }

  getArchivedRooms(landlordId: string) {
    return this.prisma.room.findMany({
      where: { landlordId, status: 'let' },
      orderBy: { letAt: 'desc' },
      take: 20,
    });
  }

  private async assertOwner(roomId: string, landlordId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.landlordId !== landlordId) throw new ForbiddenException('You do not have permission to modify this room');
    return room;
  }

  private async enforcePlanLimit(landlordId: string) {
    const profile = await this.prisma.landlordProfile.findUnique({ where: { userId: landlordId } });
    if (profile?.planTier !== 'free') return;

    const count = await this.prisma.room.count({
      where: { landlordId, status: { in: ['active', 'draft', 'reserved'] } },
    });
    if (count >= FREE_PLAN_ROOM_LIMIT) {
      throw new ForbiddenException(
        `Free plan allows up to ${FREE_PLAN_ROOM_LIMIT} active rooms. Upgrade to Pro for unlimited listings.`,
      );
    }
  }
}
