import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Filters for the portfolio-wide applicants view — Phase 7c.
 *
 * The brief: applicants were scoped per room only, so a landlord with six
 * rooms had to open six screens to find out whether anybody had applied. This
 * is one list across everything they let, narrowed the two ways a landlord
 * actually thinks — "which room" and "which place" — and sorted the two ways
 * they actually read: newest first, or the ones still waiting on them.
 */
export class ApplicantInboxDto {
  @ApiPropertyOptional({ description: 'Only applications for this room.' })
  @IsOptional() @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({ description: 'Only applications for rooms grouped under this property.' })
  @IsOptional() @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({
    enum: ['pending', 'viewed', 'shortlisted', 'accepted', 'rejected'],
    description: 'One status. Omit for everything still open.',
  })
  @IsOptional() @IsIn(['pending', 'viewed', 'shortlisted', 'accepted', 'rejected'])
  status?: 'pending' | 'viewed' | 'shortlisted' | 'accepted' | 'rejected';

  /**
   * `unread` puts what is waiting on the landlord first.
   *
   * Not a separate list, and not a filter: a landlord who has read everything
   * must still see their applicants, so this orders rather than excludes. The
   * definition is in ApplicationsService.inbox — it is "never opened, or the
   * applicant has said something since you last looked", which is the question
   * a landlord is actually asking.
   */
  @ApiPropertyOptional({ enum: ['newest', 'unread'], default: 'newest' })
  @IsOptional() @IsIn(['newest', 'unread'])
  sortBy?: 'newest' | 'unread';
}
