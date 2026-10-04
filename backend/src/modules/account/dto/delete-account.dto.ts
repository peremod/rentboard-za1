import { IsBoolean, IsOptional, IsString, Equals, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Ending an account takes more than a click — Phase 7g.
 *
 * Three things, and each one is here because of a different failure:
 *
 *   · the password, because a session somebody walked away from must not be
 *     enough to destroy their account. The settings screen already demands it
 *     to change an email address, and this is the action with nothing behind it.
 *   · the typed word, because an irreversible button that only needs a click is
 *     one people press by accident. `@Equals` on the literal, not a regex, so
 *     "delete " with a space is refused rather than half-matched.
 *   · `understood`, which the UI binds to a checkbox that arrives UNTICKED and
 *     must be ticked after reading what is kept and what is erased. Phase 7g
 *     part two learned that the shape matters: `@Equals(true)` means an absent
 *     field is a refusal, which is how a missed checkbox binding actually
 *     ships.
 */
export class DeleteAccountDto {
  @ApiPropertyOptional({ description: 'Required for any account that has a password.' })
  @IsOptional() @IsString() @MinLength(1)
  password?: string;

  @ApiProperty({
    example: 'DELETE',
    description: 'The word DELETE, typed. An irreversible action should take more than a click.',
  })
  @Equals('DELETE')
  confirm!: 'DELETE';

  @ApiProperty({
    description: 'Must arrive literally true — the box is unticked until the person has read what happens.',
  })
  @IsBoolean() @Equals(true)
  understood!: true;
}
