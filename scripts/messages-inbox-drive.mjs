/**
 * The two inboxes, and the message attribution underneath them — Phase 7c.
 *
 * ── What is worth checking here
 *
 * Not that a list comes back. Three things that were wrong, or unprovable,
 * before this phase:
 *
 *   1. **Who a WhatsApp reply is from.** `handleIncomingWebhook` stored every
 *      inbound reply with `senderId: originalMessage.senderId` — the id of the
 *      person whose message we FORWARDED, i.e. the tenant. So a landlord's
 *      reply, typed in WhatsApp, was written into the thread as though the
 *      applicant had sent it: the tenant read the landlord's answer attributed
 *      to themselves. Nothing errored, which is why it survived. The inbox is
 *      what made it visible, because an inbox has to say who each message is
 *      from.
 *   2. **`Message.readAt`.** On the model since messaging shipped and NEVER
 *      written by anything. Any unread badge built on it would have counted
 *      every message ever sent, for ever — the same defect as a
 *      `documentDeletedAt` that deletes nothing.
 *   3. **Scope.** `/applications/inbox` and `/messages/inbox` are new surfaces
 *      onto other people's private conversations. A guard decides who may ask;
 *      only the WHERE clause decides what they get, so both are checked with a
 *      second landlord and a second tenant present and holding data.
 *
 * ── Why the webhook is driven through HTTP and signed
 *
 * Because the signature check is part of what is being tested: a payload that
 * would be refused in production proves nothing about production. The signing
 * secret is read from the backend's own .env, so a drive that passes is a drive
 * against the same configuration the server is running.
 *
 * Needs the API on :3000 and a DATABASE_URL.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { registerUser, apiCall, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);

const landlord = await registerUser(API, 'LANDLORD');
const other = await registerUser(API, 'LANDLORD');
const tenantA = await registerUser(API, 'TENANT');
const tenantB = await registerUser(API, 'TENANT');
const L = landlord.token;

// ── Setup: two properties, three rooms, three applications ───────────────
const mkProperty = async (name, token) => {
  const res = await apiCall(API, 'POST', '/api/properties', {
    name, suburb: 'Tembisa', city: 'Johannesburg', province: 'Gauteng',
  }, token);
  if (res.status !== 201) throw new Error(`property ${name}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return res.body.id;
};

const roomBody = (title, extra = {}) => ({
  roomType: 'shared_house',
  title,
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 290000,
  province: 'Gauteng',
  city: 'Johannesburg',
  locationDisplay: 'Tembisa, Johannesburg',
  availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
  ...extra,
});

const mkRoom = async (title, token, extra) => {
  const res = await apiCall(API, 'POST', '/api/rooms', roomBody(title, extra), token);
  if (res.status !== 201) throw new Error(`room ${title}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  /**
   * Published straight in the database, not through the publish endpoint.
   *
   * `publish` requires a cover photo, and uploading five of them proves the
   * upload path rather than anything this drive is about. The same shortcut
   * sublet-drive.mjs takes, for the same reason.
   */
  q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${res.body.id}'`);
  return res.body.id;
};

const propA = await mkProperty(`Ext 7 back rooms ${S}`, L);
const propB = await mkProperty(`Vilakazi Street ${S}`, L);

const roomA1 = await mkRoom(`Back room one ${S}`, L, { propertyId: propA });
const roomA2 = await mkRoom(`Back room two ${S}`, L, { propertyId: propA });
const roomB1 = await mkRoom(`Front room ${S}`, L, { propertyId: propB });
const roomLoose = await mkRoom(`Ungrouped room ${S}`, L);
const roomOther = await mkRoom(`Someone else's room ${S}`, other.token);

const apply = async (roomId, tenant, note) => {
  const res = await apiCall(API, 'POST', '/api/applications', { roomId, coverNote: note }, tenant.token);
  if (res.status !== 201) throw new Error(`apply ${roomId}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return res.body.id;
};

const appA1 = await apply(roomA1, tenantA, 'I work at the mall and can move in on the first.');
const appA2 = await apply(roomA2, tenantB, 'Quiet, no pets, I can pay a month ahead.');
const appB1 = await apply(roomB1, tenantA, 'Closer to my work than where I am now.');
const appLoose = await apply(roomLoose, tenantB, 'Is the room still available?');
const appOther = await apply(roomOther, tenantA, 'A room from another landlord entirely.');

console.log('\n── 1. All applicants, across every room ────────────────────');

const all = await apiCall(API, 'GET', '/api/applications/inbox', null, L);
all.status === 200
  ? ok('a landlord can list every applicant in one call')
  : bad(`inbox returned ${all.status} ${JSON.stringify(all.body).slice(0, 160)}`);

const ids = (res) => (res.body?.data ?? []).map((a) => a.id);
const mine = [appA1, appA2, appB1, appLoose];
mine.every((id) => ids(all).includes(id))
  ? ok('…covering four applications across four rooms and two properties — the whole point of the screen')
  : bad(`expected ${mine.length} of the landlord's applications, got ${JSON.stringify(ids(all))}`);

// The row has to carry the property, or the screen cannot group or filter by it.
const rowA1 = all.body.data.find((a) => a.id === appA1);
rowA1?.room?.property?.id === propA
  ? ok('…and each row says which property the room sits on')
  : bad(`row for a grouped room came back with property ${JSON.stringify(rowA1?.room?.property)}`);

const rowLoose = all.body.data.find((a) => a.id === appLoose);
rowLoose?.room?.property == null
  ? ok('…while an ungrouped room reports no property rather than inventing one')
  : bad(`ungrouped room reported property ${JSON.stringify(rowLoose?.room?.property)}`);

console.log('\n── 2. Scope: a guard says who may ask, the WHERE says what they get ──');

/**
 * ⚠️ The precondition is asserted, not assumed.
 *
 * The first version of the next check simply looked for "appOther is absent
 * from the landlord's inbox" — which passes identically whether scoping works
 * or the other landlord's application was never created at all. A negative
 * check whose setup silently failed proves nothing in either direction. So the
 * other landlord is made to see their own row first.
 */
const theirs = await apiCall(API, 'GET', '/api/applications/inbox', null, other.token);
ids(theirs).includes(appOther)
  ? ok('the other landlord does see their own applicant (so the next check means something)')
  : bad(`the other landlord's own inbox is missing ${appOther}: ${JSON.stringify(ids(theirs))}`);

!ids(all).includes(appOther)
  ? ok('…and it is NOT in this landlord’s inbox')
  : bad('one landlord’s inbox contains another landlord’s applicant');

ids(theirs).every((id) => !mine.includes(id))
  ? ok('…nor is any of this landlord’s in theirs')
  : bad(`the other landlord can see ${JSON.stringify(ids(theirs).filter((id) => mine.includes(id)))}`);

/**
 * A TENANT may call it — `ListerGuard` admits them because a sub-lessor lets
 * rooms too — and gets their OWN lettings, which is nothing. 200-and-empty,
 * not 403: the guard is not the thing keeping them out of a landlord's data.
 */
const tenantAsk = await apiCall(API, 'GET', '/api/applications/inbox', null, tenantA.token);
tenantAsk.status === 200
  ? ok('a tenant may ask (they could be letting a room themselves) …')
  : bad(`a tenant calling the applicants inbox got ${tenantAsk.status}, expected 200`);
(tenantAsk.body?.data ?? []).length === 0
  ? ok('…and gets nothing, because they let nothing — scoped by the clause, not the guard')
  : bad(`a tenant saw ${tenantAsk.body.data.length} applicant(s) they do not let`);

console.log('\n── 3. Filters and sort ─────────────────────────────────────');

const byRoom = await apiCall(API, 'GET', `/api/applications/inbox?roomId=${roomA1}`, null, L);
ids(byRoom).length === 1 && ids(byRoom)[0] === appA1
  ? ok('filtering by room narrows to that room')
  : bad(`roomId filter returned ${JSON.stringify(ids(byRoom))}`);

const byProperty = await apiCall(API, 'GET', `/api/applications/inbox?propertyId=${propA}`, null, L);
ids(byProperty).length === 2 && ids(byProperty).includes(appA1) && ids(byProperty).includes(appA2)
  ? ok('filtering by property narrows to the rooms grouped under it')
  : bad(`propertyId filter returned ${JSON.stringify(ids(byProperty))}`);

const byStatus = await apiCall(API, 'GET', '/api/applications/inbox?status=shortlisted', null, L);
ids(byStatus).length === 0
  ? ok('filtering by a status nobody has yet returns an empty list, not everything')
  : bad(`status=shortlisted returned ${JSON.stringify(ids(byStatus))}`);

await apiCall(API, 'POST', `/api/applications/${appA1}/shortlist`, {}, L);
const shortlisted = await apiCall(API, 'GET', '/api/applications/inbox?status=shortlisted', null, L);
ids(shortlisted).length === 1 && ids(shortlisted)[0] === appA1
  ? ok('…and finds the one once it exists')
  : bad(`status=shortlisted returned ${JSON.stringify(ids(shortlisted))}`);

const bogus = await apiCall(API, 'GET', '/api/applications/inbox?roomId=not-a-uuid', null, L);
bogus.status === 400
  ? ok('a malformed room id is refused rather than quietly ignored')
  : bad(`roomId=not-a-uuid returned ${bogus.status}, expected 400`);

/**
 * "Waiting on you" is never-opened OR they have said something since. Opening
 * appA1 (above, via shortlist) does not mark it viewed, so viewed status is set
 * explicitly for a row that must then sink.
 */
await apiCall(API, 'POST', `/api/applications/${appLoose}/view`, {}, L);
const sorted = await apiCall(API, 'GET', '/api/applications/inbox?sortBy=unread', null, L);
const firstWaiting = (sorted.body?.data ?? []).findIndex((a) => !a.needsAttention);
const lastWaiting = [...(sorted.body?.data ?? [])].reduce(
  (acc, a, i) => (a.needsAttention ? i : acc), -1,
);
firstWaiting === -1 || lastWaiting < firstWaiting
  ? ok('sortBy=unread puts everything waiting on the landlord above everything that is not')
  : bad('an applicant needing attention was sorted below one that does not');

const viewedRow = (sorted.body?.data ?? []).find((a) => a.id === appLoose);
viewedRow && viewedRow.needsAttention === false
  ? ok('…and an opened applicant with nothing new to say stops asking for attention')
  : bad(`an opened applicant still reports needsAttention: ${JSON.stringify(viewedRow?.needsAttention)}`);

console.log('\n── 4. The unified message inbox ────────────────────────────');

const empty = await apiCall(API, 'GET', '/api/messages/inbox', null, L);
empty.status === 200 && (empty.body?.data ?? []).length === 0
  ? ok('a landlord nobody has written to has an empty inbox, not an error')
  : bad(`messages inbox with no messages returned ${empty.status} / ${JSON.stringify(empty.body).slice(0, 160)}`);

const sent = await apiCall(API, 'POST', `/api/applications/${appA1}/messages`,
  { body: 'Good day, is the room still open? I can come see it on Saturday.' }, tenantA.token);
sent.status === 201
  ? ok('a tenant can write in their application thread')
  : bad(`sending a message returned ${sent.status} ${JSON.stringify(sent.body).slice(0, 160)}`);

const lInbox = await apiCall(API, 'GET', '/api/messages/inbox', null, L);
const thread = (lInbox.body?.data ?? []).find((t) => t.applicationId === appA1);
thread
  ? ok('…and it appears in the landlord’s inbox without them knowing which room to look in')
  : bad(`the landlord’s inbox has no thread for ${appA1}: ${JSON.stringify(ids({ body: { data: [] } }))}`);

thread?.iAmLandlord === true && thread?.withName === 'Drive Tenant'
  ? ok('…saying which side they are on and who it is with')
  : bad(`thread says iAmLandlord=${thread?.iAmLandlord} with=${JSON.stringify(thread?.withName)}`);

thread?.unread === 1
  ? ok('…and that one message is unread — Message.readAt is finally written by something')
  : bad(`unread came back as ${JSON.stringify(thread?.unread)}, expected 1`);

thread?.lastMessage?.channel === 'in_app' && thread?.lastMessage?.fromMe === false
  ? ok('…on which channel, and from whom')
  : bad(`lastMessage was ${JSON.stringify(thread?.lastMessage)}`);

const tInbox = await apiCall(API, 'GET', '/api/messages/inbox', null, tenantA.token);
const tThread = (tInbox.body?.data ?? []).find((t) => t.applicationId === appA1);
tThread?.iAmLandlord === false && tThread?.unread === 0
  ? ok('the tenant sees the same thread from the other side, with their OWN message not counted unread')
  : bad(`tenant's view: iAmLandlord=${tThread?.iAmLandlord} unread=${JSON.stringify(tThread?.unread)}`);

const notMine = (tInbox.body?.data ?? []).find((t) => t.applicationId === appA2);
!notMine
  ? ok('…and nothing of the other tenant’s')
  : bad('a tenant can see a conversation they are not part of');

console.log('\n── 5. readAt: opening a thread is what marks it read ───────');

const openThread = await apiCall(API, 'GET', `/api/applications/${appA1}/messages`, null, L);
openThread.status === 200
  ? ok('the landlord opens the conversation')
  : bad(`opening the thread returned ${openThread.status}`);

// The write is fire-and-forget on the server, so give it a moment rather than
// racing it. A check that fails one run in five is an alarm nobody reads.
await new Promise((r) => setTimeout(r, 400));

const afterOpen = await apiCall(API, 'GET', '/api/messages/inbox', null, L);
const readThread = (afterOpen.body?.data ?? []).find((t) => t.applicationId === appA1);
readThread?.unread === 0
  ? ok('…and the unread count clears')
  : bad(`unread after opening is ${JSON.stringify(readThread?.unread)}, expected 0`);

const dbRead = q(`SELECT COUNT(*) FROM messages WHERE "applicationId" = '${appA1}' AND "readAt" IS NOT NULL`);
dbRead === '1'
  ? ok('…because a row was actually written, not because the count was computed differently')
  : bad(`messages.read_at is set on ${dbRead} row(s), expected 1`);

/**
 * Only the OTHER party's. Marking your own read is meaningless and would make
 * the count on the other side depend on whether you had looked at your own words.
 */
const lReply = await apiCall(API, 'POST', `/api/applications/${appA1}/messages`,
  { body: 'Yes it is open. Saturday at ten suits me.' }, L);
lReply.status === 201 ? ok('the landlord replies') : bad(`landlord reply returned ${lReply.status}`);

await apiCall(API, 'GET', `/api/applications/${appA1}/messages`, null, L);
await new Promise((r) => setTimeout(r, 400));
const stillUnread = q(`SELECT "readAt" IS NULL FROM messages WHERE id = '${lReply.body.id}'`);
stillUnread === 't'
  ? ok('…and re-opening it does NOT mark the landlord’s own message read')
  : bad('opening a thread marked the opener’s own message read, which would hide it from the other side');

console.log('\n── 6. A WhatsApp reply is attributed to whoever sent it ────');

/**
 * ⚠️ This is the regression the inbox exposed.
 *
 * The forwarded tenant message is given a wamid directly: the real one comes
 * back from Meta, which a drive cannot reach. Everything after that point is
 * the production path — the signed webhook, the wamid lookup, the number→
 * landlord resolution and the write.
 */
const profileId = q(`SELECT id FROM landlord_profiles WHERE "userId" = '${landlord.id}'`);
if (!profileId) throw new Error('the landlord has no LandlordProfile — the rest of this section cannot run');
const LANDLORD_WA = `+2782555${String(S).padStart(4, '0').slice(0, 4)}`;
// One line, deliberately: dbQuery passes the SQL through JSON.stringify to
// psql -c, which turns a newline into a literal backslash-n and errors.
q(`INSERT INTO landlord_whatsapp_configs (id, "landlordId", "phoneNumber", "phoneVerified", "waEnabled", "optInAt") VALUES ('${crypto.randomUUID()}', '${profileId}', '${LANDLORD_WA}', true, true, now()) ON CONFLICT ("landlordId") DO UPDATE SET "phoneNumber" = '${LANDLORD_WA}'`);
q(`SELECT "phoneNumber" FROM landlord_whatsapp_configs WHERE "landlordId" = '${profileId}'`) === LANDLORD_WA
  ? ok('the landlord has opted a number in (the only thing that identifies them on the way back)')
  : bad('the WhatsApp config row was not written — the rest of this section proves nothing');

const WAMID = `wamid.drive.${S}`;
q(`UPDATE messages SET "waMessageId" = '${WAMID}' WHERE id = '${sent.body.id}'`);

const APP_SECRET = (fs.readFileSync(new URL('../backend/.env', import.meta.url), 'utf8')
  .match(/^WHATSAPP_APP_SECRET=(.*)$/m) ?? [])[1]?.trim();
if (!APP_SECRET) throw new Error('WHATSAPP_APP_SECRET is not set in backend/.env — the webhook would refuse every payload');

const postWebhook = async (payload) => {
  const raw = JSON.stringify(payload);
  const sig = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  const res = await fetch(`${API}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig },
    body: raw,
  });
  return res.status;
};

const inbound = (from, wamid, text) => ({
  entry: [{
    changes: [{
      value: {
        contacts: [{ wa_id: from.replace(/\D/g, '') }],
        messages: [{
          id: wamid,
          from: from.replace(/\D/g, ''),
          type: 'text',
          context: { id: WAMID },
          text: { body: text },
        }],
      },
    }],
  }],
});

const unsigned = await fetch(`${API}/api/whatsapp/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(inbound(LANDLORD_WA, `wamid.unsigned.${S}`, 'forged')),
});
unsigned.status === 403
  ? ok('an unsigned webhook payload is refused (so a signed one proves the production path)')
  : bad(`an unsigned webhook returned ${unsigned.status}, expected 403`);

const replyWamid = `wamid.reply.${S}`;
const status = await postWebhook(inbound(LANDLORD_WA, replyWamid, 'Ewe, come at ten. The gate is the green one.'));
status === 200 ? ok('a signed reply from the landlord’s own number is accepted') : bad(`signed webhook returned ${status}`);

await new Promise((r) => setTimeout(r, 400));
const waSender = q(`SELECT "senderId" FROM messages WHERE "waMessageId" = '${replyWamid}'`);
waSender === landlord.id
  ? ok('…and is stored as FROM THE LANDLORD — this was the tenant’s id before Phase 7c')
  : bad(`a landlord’s WhatsApp reply was stored with sender_id ${waSender} (landlord is ${landlord.id}, tenant is ${tenantA.id})`);

const waChannel = q(`SELECT channel FROM messages WHERE "waMessageId" = '${replyWamid}'`);
waChannel === 'whatsapp'
  ? ok('…on the whatsapp channel, so the inbox can say which door it came through')
  : bad(`the reply was stored on channel ${waChannel}`);

const mixed = await apiCall(API, 'GET', '/api/messages/inbox', null, L);
const mixedThread = (mixed.body?.data ?? []).find((t) => t.applicationId === appA1);
(mixedThread?.channelsUsed ?? []).includes('whatsapp') && (mixedThread?.channelsUsed ?? []).includes('in_app')
  ? ok('…and the thread reports BOTH channels, which is what the screen warns about')
  : bad(`channelsUsed is ${JSON.stringify(mixedThread?.channelsUsed)}`);

mixedThread?.lastMessage?.channel === 'whatsapp' && mixedThread?.lastMessage?.fromMe === true
  ? ok('…with the landlord’s own WhatsApp answer as the last thing said, marked as theirs')
  : bad(`lastMessage is ${JSON.stringify(mixedThread?.lastMessage)}`);

/**
 * A reply quoting a real wamid from a number nobody opted in is dropped. That
 * is the hole the old code left open: it attributed by the wamid alone, so
 * anyone who could post a signed payload could write into a private
 * conversation under the tenant's name.
 */
const strangerWamid = `wamid.stranger.${S}`;
await postWebhook(inbound('+27829990001', strangerWamid, 'Let me into your conversation.'));
await new Promise((r) => setTimeout(r, 400));
const strangerRow = q(`SELECT COUNT(*) FROM messages WHERE "waMessageId" = '${strangerWamid}'`);
strangerRow === '0'
  ? ok('a reply from an unrecognised number is dropped, not attributed to a guess')
  : bad('a reply from a number nobody opted in was written into the conversation');

console.log('\n── 7. A closed conversation stays readable and cannot be added to ──');

await apiCall(API, 'POST', `/api/applications/${appB1}/messages`, { body: 'Is this one still open?' }, tenantA.token);
const rejected = await apiCall(API, 'POST', `/api/applications/${appB1}/reject`, { reason: 'Let to someone else' }, L);
rejected.status < 300 ? ok('the landlord turns an application down') : bad(`reject returned ${rejected.status}`);

const closedInbox = await apiCall(API, 'GET', '/api/messages/inbox', null, tenantA.token);
const closedThread = (closedInbox.body?.data ?? []).find((t) => t.applicationId === appB1);
closedThread
  ? ok('…the thread is still in the tenant’s inbox, readable')
  : bad('a rejected application’s conversation disappeared from the inbox entirely');
closedThread?.closed === true
  ? ok('…flagged closed, which is what hides the composer instead of letting a send fail silently')
  : bad(`a rejected thread reports closed: ${JSON.stringify(closedThread?.closed)}`);

const refused = await apiCall(API, 'POST', `/api/applications/${appB1}/messages`, { body: 'Please reconsider.' }, tenantA.token);
refused.status === 400
  ? ok('…and the server refuses a new message in it')
  : bad(`sending into a closed thread returned ${refused.status}, expected 400`);

console.log('\n── 8. Ordering ─────────────────────────────────────────────');

const ordered = await apiCall(API, 'GET', '/api/messages/inbox', null, tenantA.token);
const times = (ordered.body?.data ?? []).map((t) => new Date(t.lastMessage.createdAt).getTime());
times.every((t, i) => i === 0 || times[i - 1] >= t)
  ? ok('the inbox is newest-activity first — the order somebody actually reads it in')
  : bad(`threads are out of order: ${JSON.stringify(times)}`);

(ordered.body?.data ?? []).every((t) => t.messageCount > 0)
  ? ok('…and an application nobody has written in is not listed as a conversation')
  : bad('an application with no messages appeared in the inbox');

console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
