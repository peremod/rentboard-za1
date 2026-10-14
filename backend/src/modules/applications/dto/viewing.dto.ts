import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Inviting an applicant to see the room — Phase 7l.
 *
 * ⚠️ There is no `useMyPropertyAddress` flag, and that is deliberate.
 *
 * `Property.addressLine` exists, and the form where a landlord types it says in
 * these words: "Only you see this. It is never on a listing and never sent to
 * an applicant." A convenience flag here would break that promise on the
 * landlord's behalf, and they would never know it had happened. They type where
 * to meet, for this viewing, for this person.
 */
export class InviteToViewingDto {
  @ApiProperty({
    example: '2026-10-11T14:00:00.000Z',
    description: 'When to meet. Must be in the future — an invitation to a passed time is not one.',
  })
  @IsISO8601()
  startsAt!: string;

  @ApiProperty({
    example: '14 Vilakazi Street, Tembisa — the blue gate',
    description:
      'Where to meet, in your words. This IS sent to the applicant. Never pre-filled '
      + 'from your property address, which the product promised is only ever seen by you.',
  })
  @IsString()
  @MinLength(3, { message: 'Say where to meet. An invitation with no place is one nobody can turn up to.' })
  @MaxLength(300)
  meetingPlace!: string;

  @ApiPropertyOptional({
    example: 'Ask for Sipho at the gate.',
    description: 'Anything else they need — often the thing that actually gets somebody in.',
  })
  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

/**
 * The tenant's answer.
 *
 * A reason is optional on purpose: somebody who cannot come owes nobody an
 * explanation, and demanding one means they simply do not answer at all — which
 * leaves the landlord waiting at a gate instead of offering another time.
 */
export class RespondToViewingDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  accept!: boolean;

  @ApiPropertyOptional({ example: 'I am working that afternoon — could we do Sunday?' })
  @IsOptional() @IsString() @MaxLength(300)
  declineReason?: string;
}

/**
 * What happened about a viewing whose agreed time has passed — Phase 8n.
 *
 * ⚠️ The five values are not "it happened / it did not". The two that matter
 * most in practice are the ones a yes/no cannot hold: they met at a different
 * time they agreed between themselves, and one of them went elsewhere. A list
 * that cannot record those keeps asking a question it has already been
 * answered.
 *
 * The note is optional for the same reason a decline reason is: somebody who
 * did not go owes nobody an explanation, and demanding one means they record
 * nothing at all.
 */
export class RecordViewingOutcomeDto {
  @ApiProperty({
    enum: [
      'happened',
      'rearranged_privately',
      'no_answer',
      'fell_through_other_room',
      'fell_through_other_tenant',
    ],
    example: 'rearranged_privately',
    description:
      'fell_through_other_room and fell_through_other_tenant close the application. '
      + 'Neither accepts anybody: recording that the room went elsewhere says who did '
      + 'NOT get it, never who did.',
  })
  @IsIn([
    'happened',
    'rearranged_privately',
    'no_answer',
    'fell_through_other_room',
    'fell_through_other_tenant',
  ])
  outcome!: 'happened' | 'rearranged_privately' | 'no_answer'
    | 'fell_through_other_room' | 'fell_through_other_tenant';

  @ApiPropertyOptional({ example: 'We met on the Sunday instead and he has taken it.' })
  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}
