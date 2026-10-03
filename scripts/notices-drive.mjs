/**
 * In-app notices: the channel that was write-only — Phase 7g.
 *
 * ── What was wrong
 *
 * `NoticeRouter` had been writing `Notice` rows since v1.85.0 as the channel
 * that works when there is no email address, and **nothing could read them.**
 * Its own comment calls the notice "the channel that cannot fail for reasons
 * outside our control" — true of the write and meaningless without a read. For
 * a phone-only landlord, "you have a new applicant" went into a table, WhatsApp
 * refused it outside Meta's 24-hour window, and nobody was told anything.
 *
 * It mattered far more the moment phone-only accounts could be created through
 * the front door, which is why the read API shipped in the same release.
 *
 * ── What is checked
 *
 *   1. A notice written for a user is readable BY THAT USER.
 *   2. And by nobody else. The scoping is in the WHERE clause, so another
 *      person's notice is a miss rather than a refusal — a 404-shaped answer
 *      cannot be used to discover that a notice exists.
 *   3. Marking read is also scoped: marking someone else's changes nothing.
 *   4. The unread count is the number the nav badge draws.
 *
 * Needs the API on :3000 and a DATABASE_URL — a notice is written by a
 * notification that fires on a real event, so this drive writes one directly
 * rather than staging an application just to produce one.
 */
import { registerUser, apiCall, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const mine = await registerUser(API, 'LANDLORD');
const other = await registerUser(API, 'LANDLORD');

// A marker string, so the assertions are about DATA reaching the wrong person
// rather than about which status code the refusal used. An earlier drive in this
// repo asserted a 403 and would have passed a 200 that leaked the row.
const MARK = `notice-marker-${Math.floor(Math.random() * 1e9)}`;
const id = q(`INSERT INTO notices (id,"userId",kind,title,body,link,"createdAt") VALUES (gen_random_uuid(),'${mine.id}','new_application','${MARK}','Somebody applied for your room','/landlord/dashboard',now()) RETURNING id`);

// ── 1. The owner can read it ─────────────────────────────────────────────
const list = await apiCall(API, 'GET', '/api/notices', undefined, mine.token);
JSON.stringify(list.body).includes(MARK)
  ? ok('a notice written for someone is readable by them — the channel is no longer write-only')
  : bad(`the owner cannot read their own notice: ${list.status} ${JSON.stringify(list.body).slice(0, 200)}`);

const unread = await apiCall(API, 'GET', '/api/notices/unread', undefined, mine.token);
unread.body?.count === 1
  ? ok('and the unread count is the number the nav badge draws (1)')
  : bad(`unread count is ${JSON.stringify(unread.body?.count)}, expected 1`);

// ── 2. Nobody else can ───────────────────────────────────────────────────
const theirs = await apiCall(API, 'GET', '/api/notices', undefined, other.token);
!JSON.stringify(theirs.body).includes(MARK)
  ? ok('another landlord’s list does not contain it')
  : bad('one landlord can read another’s notices');

const theirCount = await apiCall(API, 'GET', '/api/notices/unread', undefined, other.token);
theirCount.body?.count === 0
  ? ok('and their unread count is not inflated by it')
  : bad(`another account's unread count is ${theirCount.body?.count}`);

// ── 3. Marking read is scoped the same way ───────────────────────────────
const steal = await apiCall(API, 'PATCH', `/api/notices/${id}/read`, {}, other.token);
const stillUnread = q(`SELECT ("readAt" IS NULL)::text FROM notices WHERE id='${id}'`);
stillUnread === 'true'
  ? ok('a stranger marking it read changes nothing (scoped in the WHERE, not checked after)')
  : bad(`another account marked someone else's notice read (${steal.status})`);

const own = await apiCall(API, 'PATCH', `/api/notices/${id}/read`, {}, mine.token);
own.body?.updated === 1 && q(`SELECT ("readAt" IS NOT NULL)::text FROM notices WHERE id='${id}'`) === 'true'
  ? ok('the owner marking it read works, once')
  : bad(`owner mark-read returned ${own.status} ${JSON.stringify(own.body)}`);

const again = await apiCall(API, 'PATCH', `/api/notices/${id}/read`, {}, mine.token);
again.body?.updated === 0
  ? ok('and marking it again updates nothing rather than rewriting the timestamp')
  : bad(`a second mark-read reported ${JSON.stringify(again.body)}`);

// ── 4. Mark-all ──────────────────────────────────────────────────────────
q(`INSERT INTO notices (id,"userId",kind,title,"createdAt") VALUES (gen_random_uuid(),'${mine.id}','shortlisted','${MARK}-2',now()), (gen_random_uuid(),'${mine.id}','room_unavailable','${MARK}-3',now())`);
const all = await apiCall(API, 'POST', '/api/notices/read-all', {}, mine.token);
all.body?.updated === 2
  ? ok('mark-all clears exactly the unread ones')
  : bad(`read-all reported ${JSON.stringify(all.body)}, expected 2`);
const after = await apiCall(API, 'GET', '/api/notices/unread', undefined, mine.token);
after.body?.count === 0
  ? ok('and the badge goes to zero')
  : bad(`unread count is still ${after.body?.count}`);

q(`DELETE FROM users WHERE id IN ('${mine.id}','${other.id}')`);

console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ notices are readable by their owner, by nobody else, and the count is the badge');
process.exit(fail ? 1 : 0);
