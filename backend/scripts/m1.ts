// M1 evidence (ROADMAP Day 7): through the API alone, a scripted customer
// conversation books a slot, and a handoff reaches the Dave conversation.
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
	const said = reply?.parts.filter((p) => p.type === 'text').map((p) => p.text).join(' ');
	console.log(`  desk     < ${said}`);
	return reply;
}

const usedTool = (m: Message | undefined, name: string) =>
	m?.parts.some((p) => p.type === 'dynamic-tool' && p.toolName === name && p.state === 'output-available');

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
const script = [
	'Hi, can you mow my lawn? It is half an acre at 45 Oak Rd, Birchwood.',
	'The first time works for me.',
	"I'm Sarah Lee.",
	'Yes, please book the first time you offered.',
];
let booked: Booking | undefined;
for (const body of script) {
	await text(customer, token, body);
	const { bookings } = await api<{ bookings: Booking[] }>(`/calendar/${visitorId}`, { token });
	booked = bookings.find((b) => !before.some((p) => p.id === b.id));
	if (booked) break;
}
if (!booked) throw new Error('M1 failed: no booking reached the calendar');
console.log(`\n✓ booked in GET /calendar/${visitorId}: ${booked.id} ${booked.start} — ${booked.basis}`);

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
		exit(0);
	}
	await sleep(1000);
}
throw new Error('M1 failed: no alert in the Dave conversation');
