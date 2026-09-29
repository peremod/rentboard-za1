import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';

/**
 * The retention queue, visible and drainable.
 *
 * ── Why this is exposed at all
 *
 * Because "files are deleted" was an unfalsifiable claim for the entire life of
 * this codebase, and an unfalsifiable claim about someone's ID document is not
 * acceptable. Two things follow from that:
 *
 *   · `GET status` so the promise can be CHECKED — outstanding count, how many
 *     are stuck, and the oldest thing still waiting. An admin can answer "is
 *     anything we said we deleted still sitting there" without database access.
 *   · `POST drain` so it can be checked on demand rather than at the top of the
 *     hour, and so scripts/storage-drive.mjs can prove a DELETE really goes out
 *     instead of reading the code and believing it.
 *
 * Admin-only. Neither route names a file or reveals a path: the counts say
 * whether the platform is keeping its word, which is a different question from
 * what any individual uploaded.
 */
@ApiTags('admin')
@Controller('admin/storage')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class StorageController {
  constructor(
    private storage: StorageService,
    private prisma: PrismaService,
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Is the deletion promise being kept?',
    description:
      'Counts only — never a path or a filename. `stuck` above zero means files the privacy policy and PAIA manual say are deleted have not been.',
  })
  async status() {
    const [outstanding, stuck, deleted, alreadyGone, oldest] = await Promise.all([
      this.prisma.fileDeletion.count({ where: { deletedAt: null } }),
      this.prisma.fileDeletion.count({ where: { deletedAt: null, attempts: { gte: 8 } } }),
      this.prisma.fileDeletion.count({ where: { deletedAt: { not: null }, alreadyGone: false } }),
      this.prisma.fileDeletion.count({ where: { alreadyGone: true } }),
      this.prisma.fileDeletion.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        // No path. The oldest outstanding deletion's AGE is the compliance
        // fact; which file it is does not make the answer any truer.
        select: { createdAt: true, attempts: true, lastError: true },
      }),
    ]);
    return {
      outstanding,
      stuck,
      deleted,
      alreadyGone,
      oldestOutstanding: oldest?.createdAt ?? null,
      oldestAttempts: oldest?.attempts ?? null,
      oldestError: oldest?.lastError ?? null,
      /** Said in the payload so a reader does not have to infer it from zeroes. */
      note:
        stuck > 0
          ? 'Some files could not be deleted. The privacy policy and the PAIA manual both state that uploaded documents are deleted — that is currently not true of these.'
          : outstanding > 0
            ? 'Deletions are pending. They are retried hourly.'
            : 'Nothing is waiting to be deleted.',
    };
  }

  @Post('drain')
  @ApiOperation({
    summary: 'Work the deletion queue now',
    description: 'Returns what happened per file — attempted, deleted, already absent, failed. A failure is reported as a failure and the row stays outstanding.',
  })
  drain() {
    return this.storage.drain();
  }
}
