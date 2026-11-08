// M1 evidence (ROADMAP Day 7): through the API alone, a scripted customer
// conversation books a slot, and a handoff reaches the Dave conversation. Then the
// off-script turns of build-plan §4 "Conversation": a question after a handoff, a
// greeting, a price question, haggling, and a complaint with no booking intent.
// Last, live dates (build-plan §12): "next Tuesday" books on the real date.
//
//   npx vite dev --port 8787 --strictPort        # in another terminal
//   ACCESS_CODE=... NICKNAME=... node scripts/m1.ts
//
// NICKNAME must be in the local allowlist (build-plan §8 "Allowlist operations");
// use a made-up test nickname, never a member's. BASE_URL defaults to
// http://localhost:8787/api. The script resets the visitor's calendar first, so
// it runs against a fresh generation. It calls the real Workers AI model.
import { env, exit } from 'node:process';

const BASE = env.BASE_URL ?? 'http://localhost:8787/api';
const { ACCESS_CODE, NICKNAME } = env;
if (!ACCESS_CODE || !NICKNAME) {
	console.error('Set ACCESS_CODE and NICKNAME (an allowlisted test nickname).');
	exit(1);
}

interface Part {
	type: string;
	text?: string;
	toolName?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
}
interface Message {
	role: string;
	purpose: string;
	signal?: { tagName?: string; attributes?: Record<string, string> };
	parts: Part[];
}
interface Snapshot {
	messages: Message[];
	settlements: { submissionId: string; outcome: string; answeredBySubmissionId?: string }[];
}
interface Booking {
	id: string;
	start: string;
	name: string;
	basis: string;
}

async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (init.token) headers.authorization = `Bearer ${init.token}`;
	const res = await fetch(`${BASE}${path}`, { ...init, headers });
	const body = await res.text();
	if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${body}`);
	return JSON.parse(body) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls the conversation until the submission settles (2 min cap). */
async function settled(path: string, token: string, submissionId: string): Promise<Snapshot> {
	for (let i = 0; i < 120; i++) {
		const snap = await api<Snapshot>(path, { token });
		const done = snap.settlements.find(
			(s) => s.submissionId === submissionId || s.answeredBySubmissionId === submissionId,
		);
		if (done) {
			if (done.outcome !== 'completed') throw new Error(`submission ${submissionId} ${done.outcome}`);
			return snap;
		}
		await sleep(1000);
	}
	throw new Error(`submission ${submissionId} did not settle`);
}

/** Sends one customer text and prints the reply and the tool calls of that response. */
async function text(path: string, token: string, body: string): Promise<Message | undefined> {
	console.log(`\n  customer > ${body}`);
	const { submissionId } = await api<{ submissionId: string }>(path, {
		method: 'POST',
		token,
		body: JSON.stringify({ kind: 'user', body }),
	});
	const snap = await settled(path, token, submissionId);
	const reply = snap.messages.at(-1);
	for (const part of reply?.parts ?? []) {
		if (part.type === 'dynamic-tool') {
			const result = part.state === 'output-error' ? `ERROR ${part.errorText}` : JSON.stringify(part.output);
			console.log(`  [tool] ${part.toolName}(${JSON.stringify(part.input)}) → ${result}`);
		}
	}
	console.log(`  desk     < ${said(reply)}`);
	return reply;
}

const toolOutputs = (m: Message | undefined, name: string) =>
	(m?.parts ?? []).filter((p) => p.type === 'dynamic-tool' && p.toolName === name && p.state === 'output-available');
const usedTool = (m: Message | undefined, name: string) => toolOutputs(m, name).length > 0;
const said = (m: Message | undefined) =>
	(m?.parts ?? [])
		.filter((p) => p.type === 'text')
		.map((p) => p.text)
		.join(' ');
/** Every handoff reply ends with this (`handoffReply` in src/desk/tools.ts). */
const HANDOFF_LINE = 'contact you directly';
/** Off-script check: fails the run with the reason. */
function expectThat(ok: boolean, what: string, reply: Message | undefined): void {
	if (!ok) throw new Error(`Off-script failed: ${what} (desk said: ${said(reply)})`);
}

// 1. Sign in and start a fresh generation.
const { visitorId, token } = await api<{ visitorId: string; token: string }>('/auth', {
	method: 'POST',
	body: JSON.stringify({ accessCode: ACCESS_CODE, nickname: NICKNAME }),
});
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

// 3. Handoff: a 2-acre yard goes to Dave.
const handoff = `/agents/lawn-desk/${visitorId}:${generation}:+15550102`;
console.log(`\n# Handoff conversation ${handoff}`);
const reply = await text(handoff, token, 'Hello, how much to mow my 2 acre lot at 9 Hill Rd, Ashford? I am Ann.');
if (!usedTool(reply, 'handoffToDave')) throw new Error('M1 failed: the 2-acre request was not handed off');

const dave = `/agents/dave-phone/${visitorId}:${generation}:dave`;
for (let i = 0; i < 120; i++) {
	const snap = await api<Snapshot>(dave, { token });
	const alert = snap.messages.find((m) => m.signal?.tagName === 'handoff');
	const sms = snap.messages.findLast((m) => m.role === 'assistant')?.parts.find((p) => p.type === 'text' && p.state === 'done');
	if (alert && sms) {
		console.log(`\n✓ alert in GET ${dave}`);
		console.log(`  signal: ${JSON.stringify(alert.signal?.attributes)} ${alert.parts.map((p) => p.text).join(' ')}`);
		console.log(`  dave   < ${sms.text}`);
		console.log('\nM1 reached.');
		break;
	}
	if (i === 119) throw new Error('M1 failed: no alert in the Dave conversation');
	await sleep(1000);
}

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
const reason = (toolOutputs(complaint, 'handoffToDave')[0]?.input as { reason?: string } | undefined)?.reason;
expectThat(reason === 'complaint' || reason === 'refund', 'did not hand off a complaint', complaint);
console.log('\n✓ Off-script turns passed.');

// 5. Live dates (build-plan §12): in a fresh generation, "next Tuesday" books on
// the first Tuesday after Dave's today, from the calendar snapshot.
const fresh = await api<{ generation: number; today: string; timeZone: string; bookings: Booking[] }>(
	`/calendar/${visitorId}/reset`,
	{ method: 'POST', token },
);
const daysToTuesday = ((2 - new Date(`${fresh.today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const tuesday = new Date(Date.parse(`${fresh.today}T00:00:00Z`) + daysToTuesday * 86_400_000).toISOString().slice(0, 10);
const dated = `/agents/lawn-desk/${visitorId}:${fresh.generation}:+15550105`;
console.log(`\n# Live dates: today ${fresh.today} (${fresh.timeZone}), next Tuesday ${tuesday}, in ${dated}`);
const ask = await text(dated, token, 'Hi! Can you mow next Tuesday? It is half an acre at 8 Fen Ct, Dunmore.');
const offered = toolOutputs(ask, 'findSlots')[0]?.output as { slots?: { start: string }[] } | undefined;
expectThat(Boolean(offered?.slots?.some((s) => s.start.startsWith(tuesday))), `did not offer a time on ${tuesday}`, ask);
let tuesdayBooking: Booking | undefined;
for (const body of ['The Tuesday time works for me.', "I'm Lee Park.", 'Yes, please book the Tuesday time.']) {
	await text(dated, token, body);
	const { bookings } = await api<{ bookings: Booking[] }>(`/calendar/${visitorId}`, { token });
	tuesdayBooking = bookings.find((b) => !fresh.bookings.some((p) => p.id === b.id));
	if (tuesdayBooking) break;
}
if (!tuesdayBooking?.start.startsWith(tuesday)) {
	throw new Error(`Live dates failed: booked ${tuesdayBooking?.start ?? 'nothing'}, expected ${tuesday}`);
}
console.log(`\n✓ Live dates: ${tuesdayBooking.id} ${tuesdayBooking.start} — ${tuesdayBooking.basis}`);
