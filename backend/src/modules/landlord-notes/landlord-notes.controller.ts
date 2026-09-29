import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LandlordNotesService } from './landlord-notes.service';
import { WriteNoteDto } from './dto/note.dto';

/**
 * A landlord's own notes — Phase 5e.
 *
 * Every route is scoped to the caller inside the query, not by a check after
 * loading. There is no route that returns another landlord's notes, and none
 * that lets a tenant read notes about themselves: that right exists under POPIA
 * s.23 but is against the landlord, and is handled by the logged,
 * admin-assisted subject-request path rather than self-service.
 */
@ApiTags('landlord')
@Controller('landlord/notes')
@UseGuards(JwtAuthGuard, LandlordGuard)
@ApiBearerAuth()
export class LandlordNotesController {
  constructor(private notes: LandlordNotesService) {}

  @Get()
  @ApiOperation({ summary: 'Every note you have written, grouped by person' })
  listAll(@CurrentUser() user: { id: string }) {
    return this.notes.listAll(user.id);
  }

  @Get('tenant/:tenantId')
  @ApiOperation({
    summary: 'Your notes about one person',
    description:
      'Empty list, not 404, for someone you have never noted — a 404 would confirm whether that account exists.',
  })
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string, @CurrentUser() user: { id: string }) {
    return this.notes.list(user.id, tenantId);
  }

  @Post('tenant/:tenantId')
  @ApiOperation({
    summary: 'Write a note about someone you have dealt with',
    description:
      'Only about a person who has applied to one of your rooms or rented from you. Without that limit this endpoint is a way to keep a private file on any account id you can guess.',
  })
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: WriteNoteDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.notes.create(user.id, tenantId, dto.body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit your own note' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WriteNoteDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.notes.update(user.id, id, dto.body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete your own note' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.notes.remove(user.id, id);
  }
}
