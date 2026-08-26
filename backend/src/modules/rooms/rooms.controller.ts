import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Header, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoomsService } from './rooms.service';
import { RoomFiltersDto } from './dto/room-filters.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { UpdatePhotosDto } from './dto/update-photos.dto';
import { RelistDto } from './dto/relist.dto';

@ApiTags('rooms')
@Controller('rooms')
export class RoomsController {
  constructor(private roomsService: RoomsService) {}

  // ── Landlord dashboard — MUST be declared before ':id' or 'my-rooms' would match as an id ──
  @Get('my-rooms')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Active + draft rooms for the authenticated landlord' })
  myRooms(@CurrentUser() user: { id: string }) {
    return this.roomsService.getLandlordRooms(user.id);
  }

  @Get('my-rooms/archived')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Let (archived) rooms — for one-click relist' })
  archivedRooms(@CurrentUser() user: { id: string }) {
    return this.roomsService.getArchivedRooms(user.id);
  }

  // ── Public notice board ──
  @Get()
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=30')
  @ApiOperation({ summary: 'Browse active room listings' })
  findAll(@Query() query: RoomFiltersDto) {
    return this.roomsService.findAll(query);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @Header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60')
  @ApiOperation({ summary: 'Single room listing' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: { id: string }) {
    return this.roomsService.findOne(id, user?.id);
  }

  // ── Landlord: CRUD + lifecycle ──
  @Post()
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a room listing (starts as draft)' })
  create(@Body() dto: CreateRoomDto, @CurrentUser() user: { id: string }) {
    return this.roomsService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoomDto, @CurrentUser() user: { id: string }) {
    return this.roomsService.update(id, dto, user.id);
  }

  @Patch(':id/photos')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace a room gallery — first path becomes the cover' })
  updatePhotos(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePhotosDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.roomsService.updatePhotos(id, dto.paths, user.id);
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.roomsService.publish(id, user.id);
  }

  @Post(':id/reserve')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  reserve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.roomsService.markReserved(id, user.id);
  }

  @Post(':id/let')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  markLet(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.roomsService.markLet(id, user.id);
  }

  @Post(':id/undo-let')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  undoLet(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.roomsService.undoLet(id, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Discard a draft listing (drafts only)' })
  discardDraft(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.roomsService.discardDraft(id, user.id);
  }

  @Post(':id/relist')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'One-click relist — restores an archived room to active' })
  relist(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RelistDto, @CurrentUser() user: { id: string }) {
    return this.roomsService.relist(id, dto, user.id);
  }
}
