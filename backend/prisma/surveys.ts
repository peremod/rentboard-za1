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

/**
 * Every survey the product ships, in the shape the seed writes.
 *
 * `version` is part of the identity: a question reworded in place changes what
 * an answer MEANS without changing the answer, so new wording is a new row
 * and old responses stay attached to the questions actually asked.
 */
export type SeedSurvey = {
  slug: string;
  version: number;
  title: string;
  intro: string;
  questions: SurveyQuestion[];
  audience: { role: 'LANDLORD' | 'TENANT'; minRooms?: number };
  active: boolean;
};

export const LANDLORD_PAIN_SURVEY: SeedSurvey = {
  slug: LANDLORD_PAIN_SURVEY_SLUG,
  version: 1,
  title: 'What is hardest about renting out your rooms?',
  intro:
    'Seven short questions. Your answers decide what we build next, and nothing here is shown to tenants or to anyone else.',
  questions: LANDLORD_PAIN_QUESTIONS,
  /** Every landlord. Narrowing to 2+ rooms would exclude exactly the people
   *  question 3 exists to count. */
  audience: { role: 'LANDLORD' as const },
  active: true,
};

// ── The tenant survey ─────────────────────────────────────────────────────
//
// ⚠️ NOT the landlord questions with the nouns swapped. The two surveys exist
// for different reasons, and writing one from the other is how you end up
// asking a person looking for a room what is hard about collecting rent.
//
// The landlord survey asks what is HARD about a job they already do, because
// that decides what to build for them. This one asks what somebody is looking
// for and what goes wrong while they look, because that decides what the board
// has to show and what a listing has to carry before it is worth anybody's
// taxi fare.
//
// Every question is answerable by a person who has never used this product.
// Nothing here asks them to rate a feature they have not met: a survey at
// sign-up is talking to somebody who has seen one screen.
//
// ⚠️ No budget FIGURE, by choice. A band is enough to know whether the board
// is showing the right rooms, and an exact number on a person looking for a
// place to live is a sensitive thing to keep for no gain — POPIA s.10, the
// same reasoning that keeps room_view_days a count with no viewer in it.
export const TENANT_SEARCH_SURVEY_SLUG = 'tenant-search-2026';

export const TENANT_SEARCH_QUESTIONS: SurveyQuestion[] = [
  {
    id: 't1_looking_for',
    prompt: 'What kind of place are you looking for?',
    kind: 'choice',
    options: [
      'A room in a shared house',
      'A backroom or outside room',
      'A cottage or granny flat',
      'A whole flat or house',
      'I am not sure yet',
    ],
  },
  {
    id: 't2_when',
    prompt: 'When do you need to move?',
    kind: 'choice',
    options: ['This month', 'Next month', 'In two or three months', 'I am just looking'],
    // The one question the product can act on immediately: somebody moving
    // this month and somebody browsing need different boards.
    micro: true,
  },
  {
    id: 't3_budget_band',
    prompt: 'What can you pay a month, including water and lights?',
    kind: 'choice',
    options: ['Under R1 500', 'R1 500 – R2 500', 'R2 500 – R4 000', 'R4 000 – R6 000', 'Over R6 000'],
  },
  {
    id: 't4_where_searching',
    prompt: 'Where do you look for rooms now?',
    kind: 'choice',
    options: ['Facebook', 'WhatsApp groups', 'Gumtree', 'Signs in the street', 'Friends and family'],
    optionalText: true,
    textLabel: 'Somewhere else? Tell us where',
  },
  {
    id: 't5_hardest',
    prompt: 'What is the hardest part of finding a room?',
    kind: 'choice',
    options: [
      'Not knowing if the place is real',
      'Rooms are gone by the time I call',
      'Nobody answers the phone',
      'Getting to viewings costs money',
      'Finding anything I can afford',
    ],
  },
  {
    id: 't6_went_wrong',
    prompt: 'Has anything gone wrong for you while looking for a room?',
    kind: 'choice',
    options: [
      'I was asked for money before seeing it',
      'The room was nothing like the pictures',
      'The landlord never turned up',
      'I lost a deposit',
      'No, nothing like that',
    ],
    optionalText: true,
    textLabel: 'What happened?',
  },
  {
    id: 't7_listing_needs',
    prompt: 'What would you want on a listing before you travel to see a room?',
    kind: 'text',
  },
];

export const TENANT_SEARCH_SURVEY: SeedSurvey = {
  slug: TENANT_SEARCH_SURVEY_SLUG,
  version: 1,
  title: 'What are you looking for?',
  intro:
    'Six quick questions and one open one. Your answers help us show you the right rooms, '
    + 'and no landlord ever sees them.',
  questions: TENANT_SEARCH_QUESTIONS,
  audience: { role: 'TENANT' as const },
  active: true,
};

/** Both, for the seed and for anything that has to walk every survey. */
export const ALL_SURVEYS: SeedSurvey[] = [LANDLORD_PAIN_SURVEY, TENANT_SEARCH_SURVEY];
