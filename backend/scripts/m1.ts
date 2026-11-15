// M1 evidence (ROADMAP Day 7): through the API alone, a scripted customer
// conversation books a slot, and a handoff texts Dave's phone. Then the
// off-script turns of build-plan §4 "Conversation": a question after a handoff, a
// greeting, a price question, haggling, and a complaint with no booking intent (name
// and address asked first).
// Then live dates (build-plan §12): "next Tuesday" books on the real date. Last,
// chat-only bookings (build-plan §13): no booking before the customer texts a name.
//
//   npx vite dev --port 8787 --strictPort        # in another terminal
//   ACCESS_CODE=... NICKNAME=... node scripts/m1.ts
//
// NICKNAME must be in the local allowlist (build-plan §8 "Allowlist operations");
// use a made-up test nickname, never a member's. BASE_URL defaults to
// http://localhost:8787/api. The script resets the visitor's calendar first, so
// it runs against a fresh generation. It calls the real Workers AI model.
import { env, exit } from 'node:process';
import { api, type Booking, type DaveText, HANDOFF_LINE, type Message, said, signIn, text, toolOutputs, usedTool } from './desk-api.ts';

const { ACCESS_CODE, NICKNAME } = env;
if (!ACCESS_CODE || !NICKNAME) {
	console.error('Set ACCESS_CODE and NICKNAME (an allowlisted test nickname).');
	exit(1);
}

/** Off-script check: fails the run with the reason. */
function expectThat(ok: boolean, what: string, reply: Message | undefined): void {
	if (!ok) throw new Error(`Off-script failed: ${what} (desk said: ${said(reply)})`);
}

// 1. Sign in and start a fresh generation.
const { visitorId, token } = await signIn(ACCESS_CODE, NICKNAME);
const { generation, bookings: before } = await api<{ generation: number; bookings: Booking[] }>(
	`/calendar/${visitorId}/reset`,
	{ method: 'POST', token },
);
console.log(`signed in: visitorId=${visitorId}, generation=${generation}, preset bookings=${before.length}`);

// 2. Booking: a customer in Birchwood with half an acre.
const customer = `/agents/lawn-desk/${visitorId}:${generation}:+15550101`;
console.log(`\n# Booking conversation ${customer}`);
// The name comes in the third text: a booking before it means the agent invented one.
const NAME = 'Sarah Lee';
const script = [
	'Hi, can you mow my lawn? It is half an acre at 45 Oak Rd, Birchwood.',
	'The first time works for me.',
	`I'm ${NAME}.`,
	'Yes, please book the first time you offered.',
];
const NAME_TEXT = 2;
let booked: Booking | undefined;
let firstOffer: string | undefined;
for (const [i, body] of script.entries()) {
	const reply = await text(customer, token, body);
	const offered = toolOutputs(reply, 'findSlots')[0]?.output as { slots?: { start: string }[] } | undefined;
	if (!firstOffer && offered && usedTool(reply, 'bookSlot'))
		throw new Error('M1 failed: booked in the same reply that found the times, before the customer picked one');
	firstOffer ??= offered?.slots?.[0]?.start;
	const { bookings } = await api<{ bookings: Booking[] }>(`/calendar/${visitorId}`, { token });
	booked = bookings.find((b) => !before.some((p) => p.id === b.id));
	if (booked && i < NAME_TEXT) throw new Error(`M1 failed: booked before the customer gave a name (${booked.name})`);
	if (booked) break;
}
if (!booked) throw new Error('M1 failed: no booking reached the calendar');
if (booked.name !== NAME) throw new Error(`M1 failed: booked under ${booked.name}, not ${NAME}`);
if (booked.start !== firstOffer) throw new Error(`M1 failed: booked ${booked.start}, first offer was ${firstOffer}`);
console.log(`\n✓ booked in GET /calendar/${visitorId}: ${booked.id} ${booked.start} — ${booked.basis}`);
console.log(`  (name ${NAME} asked for before booking; start = first slot offered)`);
const daveTexts = async () => (await api<{ daveTexts: DaveText[] }>(`/calendar/${visitorId}`, { token })).daveTexts;
const bookedText = (await daveTexts()).find((t) => t.id === booked.id);
if (!bookedText?.text.startsWith(`Booked ${booked.id}: ${NAME},`)) {
	throw new Error(`M1 failed: Dave's phone has no booking text for ${booked.id} (${JSON.stringify(bookedText)})`);
}
console.log(`  dave   < ${bookedText.text}`);

// 3. Handoff: a 2-acre yard goes to Dave.
const handoff = `/agents/lawn-desk/${visitorId}:${generation}:+15550102`;
console.log(`\n# Handoff conversation ${handoff}`);
const reply = await text(handoff, token, 'Hello, how much to mow my 2 acre lot at 9 Hill Rd, Ashford? I am Ann.');
if (!usedTool(reply, 'handoffToDave')) throw new Error('M1 failed: the 2-acre request was not handed off');

// Dave's phone gets the fixed handoff text quoting the customer (build-plan §13).
const alert = (await daveTexts()).find((t) => t.text.startsWith('Please call +15550102 (yard over 1 acre).'));
if (!alert?.text.includes('9 Hill Rd, Ashford')) throw new Error(`M1 failed: no handoff text on Dave's phone (${JSON.stringify(alert)})`);
console.log(`\n✓ Dave's phone in GET /calendar/${visitorId}`);
console.log(`  dave   < ${alert.text}`);
console.log('\nM1 reached.');

// 4. Off-script turns (build-plan §4 "Conversation").
console.log(`\n# Off-script: a question after the handoff in ${handoff}`);
const after = await text(handoff, token, 'Can you tell me your price table?');
expectThat(!usedTool(after, 'handoffToDave'), 'handed off the same issue again', after);
expectThat(!said(after).includes(HANDOFF_LINE), 'repeated the handoff line instead of answering', after);
expectThat(said(after).includes('$45'), 'did not give the prices', after);

const casual = `/agents/lawn-desk/${visitorId}:${generation}:+15550103`;
console.log(`\n# Off-script: greeting, price question, haggling in ${casual}`);
const hello = await text(casual, token, 'Hi there!');
expectThat(!hello?.parts.some((p) => p.type === 'dynamic-tool'), 'called a tool on a greeting', hello);
expectThat(!/address|acre|yard/i.test(said(hello)), 'asked for booking details on a greeting', hello);
const prices = await text(casual, token, 'What do you charge for mowing?');
expectThat(!usedTool(prices, 'handoffToDave'), 'treated a price question as haggling', prices);
expectThat(said(prices).includes('$45'), 'did not give the price', prices);
const haggle = await text(casual, token, 'That is too much. Can you do it for $30?');
const haggled = toolOutputs(haggle, 'handoffToDave')[0]?.input as { reason?: string } | undefined;
expectThat(haggled?.reason === 'haggling', 'did not hand off haggling', haggle);

// A complaint wants neither a quote nor a booking; it is still handed off.
const unhappy = `/agents/lawn-desk/${visitorId}:${generation}:+15550104`;
console.log(`\n# Off-script: a complaint in ${unhappy}`);
const complaint = await text(unhappy, token, 'Your mowing yesterday damaged my fence. I want a refund.');
// Dave needs to know whose job it was (owner E2E 2026-11-14): name and address first, then the handoff.
expectThat(!usedTool(complaint, 'handoffToDave') && /name|address|street/i.test(said(complaint)), 'did not ask for the name and address first', complaint);
const details = await text(unhappy, token, "I'm Ann Lee, 9 Hill Rd, Ashford.");
const reason = (toolOutputs(details, 'handoffToDave')[0]?.input as { reason?: string } | undefined)?.reason;
expectThat(reason === 'complaint' || reason === 'refund', 'did not hand off a complaint', details);
console.log('\n✓ Off-script turns passed.');

// 5. Live dates (build-plan §12): in a fresh generation, "next Tuesday" books on
// a real Tuesday counted from Dave's today in the calendar snapshot: the coming
// one, or the one a week later (the model reads the phrase either way; the
// reply states the date, so the customer can correct it).
const fresh = await api<{ generation: number; today: string; timeZone: string; bookings: Booking[] }>(
	`/calendar/${visitorId}/reset`,
	{ method: 'POST', token },
);
const daysToTuesday = ((2 - new Date(`${fresh.today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const dayAfter = (days: number) => new Date(Date.parse(`${fresh.today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const tuesdays = [dayAfter(daysToTuesday), dayAfter(daysToTuesday + 7)];
const onTuesday = (start: string | undefined) => tuesdays.find((t) => start?.startsWith(t));
const dated = `/agents/lawn-desk/${visitorId}:${fresh.generation}:+15550105`;
console.log(`\n# Live dates: today ${fresh.today} (${fresh.timeZone}), next Tuesday ${tuesdays.join(' or ')}, in ${dated}`);
await text(dated, token, 'Hi! Can you mow next Tuesday? It is half an acre at 8 Fen Ct, Dunmore.');
let tuesdayBooking: Booking | undefined;
for (const body of ['Which times do you have that Tuesday?', 'The Tuesday time works for me.', "I'm Lee Park.", 'Yes, please book the Tuesday time.']) {
	await text(dated, token, body);
	const { bookings } = await api<{ bookings: Booking[] }>(`/calendar/${visitorId}`, { token });
	tuesdayBooking = bookings.find((b) => !fresh.bookings.some((p) => p.id === b.id));
	if (tuesdayBooking) break;
}
const bookedTuesday = onTuesday(tuesdayBooking?.start);
if (!tuesdayBooking || !bookedTuesday) {
	throw new Error(`Live dates failed: booked ${tuesdayBooking?.start ?? 'nothing'}, expected ${tuesdays.join(' or ')}`);
}
const reading = bookedTuesday === tuesdays[0] ? 'the coming Tuesday' : 'the Tuesday a week later';
console.log(`\n✓ Live dates: ${tuesdayBooking.id} ${tuesdayBooking.start} (${reading}) — ${tuesdayBooking.basis}`);

// 6. Chat-only bookings (build-plan §13): a customer who never texts a name is not
// booked, whatever the desk tries, until they text it; then the calendar and
// Dave's phone carry the texted name.
const nameless = `/agents/lawn-desk/${visitorId}:${fresh.generation}:+15550106`;
console.log(`\n# Chat-only: no name, then a name, in ${nameless}`);
const known = async () => (await api<{ bookings: Booking[] }>(`/calendar/${visitorId}`, { token })).bookings;
const beforeNameless = await known();
for (const body of ['About half an acre, 6 Heath Road, Birchwood. When can you come?', 'The first time works.', 'Yes, please book it.']) {
	await text(nameless, token, body);
	const added = (await known()).find((b) => !beforeNameless.some((p) => p.id === b.id));
	if (added) throw new Error(`Chat-only failed: booked under "${added.name}" before the customer texted a name`);
}
await text(nameless, token, "Sorry, I'm Rosa Quinn.");
let namedBooking = (await known()).find((b) => !beforeNameless.some((p) => p.id === b.id));
if (!namedBooking) {
	await text(nameless, token, 'Please book the first time for Rosa Quinn.');
	namedBooking = (await known()).find((b) => !beforeNameless.some((p) => p.id === b.id));
}
if (namedBooking?.name !== 'Rosa Quinn') throw new Error(`Chat-only failed: booked ${JSON.stringify(namedBooking?.name)}, not Rosa Quinn`);
const namedText = (await daveTexts()).find((t) => t.id === namedBooking.id);
if (!namedText?.text.includes('Rosa Quinn')) throw new Error(`Chat-only failed: Dave's phone has no text with Rosa Quinn (${JSON.stringify(namedText)})`);
console.log(`\n✓ Chat-only: ${namedBooking.id} ${namedBooking.start} — ${namedBooking.basis}`);
console.log(`  dave   < ${namedText?.text}`);
