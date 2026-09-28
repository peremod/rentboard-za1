/**
 * Survey content, in one place, imported by every writer.
 *
 * Its own module for the reason house-ads.ts is: prisma/seed.ts calls main()
 * at the top level, so importing the content from there runs the entire seed
 * and exits. Duplicating the questions instead would recreate the bug that
 * script exists to fix — one copy of some text going unrun after a change.
 *
 * ── On question ids
 *
 * `id` is what answers are keyed by in SurveyResponse.answers. Never reuse or
 * renumber one: responses already collected point at it, and changing an id
 * silently reinterprets every answer already given. Reordering the array is
 * safe; the order here is the order asked.
 *
 * ── On `micro`
 *
 * Exactly one question carries `micro: true`. That is the single question the
 * contextual prompt asks after a landlord marks a room let — the brief allows
 * one and only one there, because a person who has just finished a task will
 * answer one question and close anything longer.
 *
 * Q2 is the one chosen: someone who has just taken a tenant on has the whole
 * of dealing with tenants in front of them, which is when "what is the most
 * stressful part" is a memory rather than a guess. Q1 would be the obvious
 * alternative and is the wrong one — they have just found a tenant through
 * this platform, so asking how they usually find tenants at that exact moment
 * invites the answer the platform wants to hear.
 */

export type SurveyQuestion = {
  id: string;
  prompt: string;
  kind: 'choice' | 'text';
  /** Required when kind is 'choice'. */
  options?: string[];
  /** A choice question that also takes free text — "other", or "yes, and…". */
  optionalText?: boolean;
  /** Label for that text box. Without one the box is unlabelled, which the
   *  accessibility drive fails and a person cannot answer. */
  textLabel?: string;
  /** The one question the post-letting micro-prompt asks. Exactly one. */
  micro?: boolean;
};

export const LANDLORD_PAIN_SURVEY_SLUG = 'landlord-pain-2026';

export const LANDLORD_PAIN_QUESTIONS: SurveyQuestion[] = [
  {
    id: 'q1_find_tenants',
    prompt: 'How do you find tenants for an empty room at the moment?',
    kind: 'choice',
    options: ['Word of mouth', 'Facebook', 'Gumtree', 'A sign outside', 'Something else'],
    optionalText: true,
    textLabel: 'If something else, what?',
  },
  {
    id: 'q2_most_stressful',
    prompt: 'What is the most stressful part of dealing with tenants?',
    kind: 'choice',
    options: [
      'Getting rent on time',
      'Tenants damaging the property',
      'Working out who to trust',
      'Tenants leaving without notice',
      'Paperwork and keeping records',
    ],
    micro: true,
  },
  {
    id: 'q3_room_count',
    prompt: 'How many rooms do you rent out right now?',
    kind: 'choice',
    options: ['1', '2 to 4', '5 to 9', '10 or more'],
  },
  {
    id: 'q4_rent_tracking',
    prompt: 'How do you keep track of who has paid rent this month?',
    kind: 'choice',
    options: ['In my head', 'A notebook', 'A spreadsheet', 'Nothing formal'],
  },
  {
    id: 'q5_scammed',
    prompt: 'Has a tenant ever scammed you or seriously misled you?',
    kind: 'choice',
    options: ['Yes', 'No'],
    optionalText: true,
    textLabel: 'If yes, what happened?',
  },
  {
    id: 'q6_trust',
    prompt: 'What would make you trust an online platform to find you a tenant?',
    kind: 'text',
  },
  {
    id: 'q7_wish',
    prompt: 'What is one thing you wish existed to make managing your rooms easier?',
    kind: 'text',
  },
];

/**
 * Question 3 is the segment key for the admin view, so it is named once here
 * rather than as a string literal in the aggregation code. Renaming the
 * question without updating a hardcoded 'q3_room_count' elsewhere would leave
 * the admin view silently segmenting by nothing.
 */
export const ROOM_COUNT_QUESTION_ID = 'q3_room_count';

/** The one micro question, resolved rather than hardcoded a second time. */
export function microQuestion(questions: SurveyQuestion[] = LANDLORD_PAIN_QUESTIONS): SurveyQuestion {
  const found = questions.filter((q) => q.micro);
  if (found.length !== 1) {
    throw new Error(`exactly one question must be marked micro, found ${found.length}`);
  }
  return found[0];
}

export const LANDLORD_PAIN_SURVEY = {
  slug: LANDLORD_PAIN_SURVEY_SLUG,
  title: 'What is hardest about renting out your rooms?',
  intro:
    'Seven short questions. Your answers decide what we build next, and nothing here is shown to tenants or to anyone else.',
  questions: LANDLORD_PAIN_QUESTIONS,
  /** Every landlord. Narrowing to 2+ rooms would exclude exactly the people
   *  question 3 exists to count. */
  audience: { role: 'LANDLORD' as const },
  active: true,
};
