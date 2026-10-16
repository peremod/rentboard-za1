import { IsBoolean, IsEnum, IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SurveySource } from '@prisma/client';

export class SubmitSurveyDto {
  /**
   * Answers keyed by question id.
   *
   * Deliberately loose: a choice answer is a string, and a choice that also
   * carries free text is `{ choice, text }`. Validating the shape per question
   * here would mean teaching the DTO the question set, which is the
   * form-builder the brief explicitly says not to build. The service is where
   * this is made safe instead, and it does the one thing that matters —
   * unknown question ids are dropped rather than stored, so nothing reaches
   * the aggregate that no question explains.
   *
   * Size is bounded by the global body limit, not per-field.
   */
  @ApiProperty({
    example: { q1_find_tenants: 'Facebook', q5_scammed: { choice: 'Yes', text: 'Paid a deposit and vanished' } },
    description: 'Keyed by question id. Partial answers are accepted.',
  })
  @IsObject()
  answers!: Record<string, unknown>;

  /**
   * Which surface this came from. The three do not measure the same thing —
   * the micro prompt catches someone mid-task, the dashboard someone with time
   * to think, and WhatsApp a landlord who never opens the portal. Pooling them
   * would hide that difference in the aggregate.
   */
  @ApiPropertyOptional({ enum: ['onboarding', 'micro', 'dashboard', 'whatsapp'], default: 'dashboard' })
  @IsOptional()
  @IsEnum(['onboarding', 'micro', 'dashboard', 'whatsapp'])
  source: SurveySource = 'dashboard';

  /**
   * False while the welcome questions are still being answered.
   *
   * ⚠️ This is what makes a set resumable. Without it there is no difference
   * between "answered two and left" and "finished", so nothing can offer to
   * continue and no completion rate can be computed — both of which the old
   * model simply could not express.
   *
   * It only ever moves one way: the service will not un-complete a set that
   * was already finished.
   */
  @ApiPropertyOptional({ default: true, description: 'False for a part-way save.' })
  @IsOptional()
  @IsBoolean()
  complete?: boolean;
}
