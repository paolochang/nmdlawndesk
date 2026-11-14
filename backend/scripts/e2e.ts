// E2E score (build-plan §16, ROADMAP M3): the 10 scripted customer texts, scored on
// tool outcomes and the calendar rather than wording, plus must-pass turns (greeting,
// price question, a question after a handoff, off-topic texts) and style checks on
// every desk reply (think tags, lists, symbols, internal ids, invented amounts). A
// price without the on-site note is a warning only. Exits non-zero below 9/10 or on any
// must-pass failure.
//
//   npx vite dev --port 8787 --strictPort        # in another terminal
//   ACCESS_CODE=... NICKNAME=... node scripts/e2e.ts
//   ONLY=4,7,offtopic ACCESS_CODE=... NICKNAME=... node scripts/e2e.ts   # a subset
//
// NICKNAME must be an allowlisted made-up test nickname, never a member's. The run
// resets that visitor's calendar once, then texts from a new phone per case. Every
// run calls the real Workers AI model and spends the account's daily allowance
// (about 40 neurons per customer text, about 800 per full run). While fixing, run
// only the failing cases with ONLY=; run the full suite only for the final check.
import { env, exit } from 'node:process';
import {
	anyTool,
	api,
	type Booking,
	HANDOFF_LINE,
	type Message,
	said,
	signIn,
	text,
	toolOutputs,
	usedTool,
} from './desk-api.ts';

const { ACCESS_CODE, NICKNAME } = env;
if (!ACCESS_CODE || !NICKNAME) {
	console.error('Set ACCESS_CODE and NICKNAME (an allowlisted test nickname).');
	exit(1);
}
const only = env.ONLY?.split(',').map((s) => s.trim());
const selected = (id: string) => !only || only.includes(id);

const { visitorId, token } = await signIn(ACCESS_CODE, NICKNAME);
const fresh = await api<{ generation: number; today: string; bookings: Booking[] }>(`/calendar/${visitorId}/reset`, {
	method: 'POST',
	token,
});
const { generation, today } = fresh;
const known = new Set(fresh.bookings.map((b) => b.id));
console.log(`signed in: visitorId=${visitorId}, generation=${generation}, today=${today}`);

/** A customer conversation from a new phone, keeping every reply for the style checks. */
interface Convo {
	id: string;
	replies: Message[];
	customerTexts: string[];
	say(body: string): Promise<Message | undefined>;
}
const conversations: Convo[] = [];
let phones = 0;
function convo(label: string): Convo {
	const phone = `+1555${String(300 + ++phones).padStart(4, '0')}`;
	const path = `/agents/lawn-desk/${visitorId}:${generation}:${phone}`;
	console.log(`\n# ${label} (${phone})`);
	const c: Convo = {
		id: label,
		replies: [],
		customerTexts: [],
		async say(body) {
			c.customerTexts.push(body);
			const reply = await text(path, token, body);
			if (reply) c.replies.push(reply);
			return reply;
		},
	};
	conversations.push(c);
	return c;
}

// --- reading the desk's work ---------------------------------------------------

const outputsOf = (c: Convo, tool: string) => c.replies.flatMap((r) => toolOutputs(r, tool));
const inputsOf = (c: Convo, tool: string) => outputsOf(c, tool).map((p) => p.input as Record<string, unknown>);
const quotes = (c: Convo) => outputsOf(c, 'quoteJob').map((p) => p.output as { price?: string; handoff?: string });
const offers = (c: Convo) =>
	outputsOf(c, 'findSlots').flatMap((p) => (p.output as { slots?: { start: string }[] }).slots ?? []).map((s) => s.start);
const handoffReasons = (c: Convo) => inputsOf(c, 'handoffToDave').map((i) => i.reason);
const weekday = (start: string) => new Date(`${start.slice(0, 10)}T00:00:00Z`).getUTCDay();
const onDays = (starts: string[], days: number[]) => starts.length >= 2 && starts.every((s) => days.includes(weekday(s)));
/** "may change on site", "changing on site", "adjusted on site" … */
const ON_SITE = /(chang|adjust)\w* on site/i;
/** The price reached the customer: quoteJob returned it or a desk text stated it (amounts are checked against the rules and tools below). */
const quoted = (c: Convo, price: string) => quotes(c).some((q) => q.price === price) || c.replies.some((r) => said(r).includes(price));
/** Asked for what is missing: no tool call, and the text names the address or the yard size. */
const asksDetails = (m: Message | undefined) => !anyTool(m) && /town|address|street|where|size|acre|how big/i.test(said(m));
const MON_THU = [1, 4];
const TUE_FRI = [2, 5];

async function newBookings(): Promise<Booking[]> {
	const { bookings } = await api<{ bookings: Booking[] }>(`/calendar/${visitorId}`, { token });
	const added = bookings.filter((b) => !known.has(b.id));
	for (const b of added) known.add(b.id);
	return added;
}

/** Texts until the desk offers times (at most one nudge). */
async function untilOffers(c: Convo, nudge: string): Promise<string[]> {
	if (offers(c).length === 0) await c.say(nudge);
	return offers(c);
}

/** Picks a time, then confirms, until a booking lands (at most three texts). */
async function untilBooked(c: Convo, texts: string[]): Promise<Booking | undefined> {
	for (const body of texts) {
		await c.say(body);
		const [booking] = await newBookings();
		if (booking) return booking;
	}
	return undefined;
}

// --- the 10 cases ----------------------------------------------------------------

interface Result {
	id: string;
	pass: boolean;
	why: string;
}
type Case = { id: string; title: string; run(): Promise<Result['why'] | true> };

const cases: Case[] = [
	{
		id: '1',
		title: 'Everything in one text, then a pick',
		async run() {
			const c = convo('1 complete');
			await c.say("Hi, I'm Mia Chen. Can you mow my lawn at 12 Elm St, Ashford? It's about half an acre.");
			const offered = await untilOffers(c, 'Great, what times do you have?');
			if (!quoted(c, '$45')) return 'no $45 quote';
			if (!onDays(offered, MON_THU)) return `times not on Mon/Thu: ${offered.join(', ')}`;
			const booking = await untilBooked(c, ['The first time works for me.', 'Yes, please book the first time you offered.']);
			if (!booking) return 'no booking';
			if (booking.start !== offered[0]) return `booked ${booking.start}, first offer ${offered[0]}`;
			return booking.name === 'Mia Chen' || `booked under ${booking.name}`;
		},
	},
	{
		id: '2',
		title: 'A bare price question, then the details',
		async run() {
			const c = convo('2 incomplete');
			const first = await c.say('How much to mow my lawn?');
			if (!asksDetails(first)) return 'did not ask for the missing details (or called a tool first)';
			await c.say("It's 30 Mill Rd, Clearwater, about a quarter acre.");
			const offered = await untilOffers(c, 'What times do you have?');
			if (!quoted(c, '$45')) return 'no $45 quote';
			return onDays(offered, MON_THU) || `times not on Mon/Thu: ${offered.join(', ')}`;
		},
	},
	{
		id: '3',
		title: 'Misspelled town',
		async run() {
			const c = convo('3 misspelled');
			await c.say("Can you mow my lawn at 7 Lake Dr, Clearwatr? It's half an acre.");
			const offered = await untilOffers(c, 'Yes, Clearwater.');
			if (handoffReasons(c).includes('out-of-area')) return 'handed off as out of area';
			return onDays(offered, MON_THU) || `times not on Mon/Thu: ${offered.join(', ')}`;
		},
	},
	{
		id: '4',
		title: 'Out of area',
		async run() {
			const c = convo('4 out of area');
			await c.say("Hi, can you mow my lawn at 4 Bay St, Kestrel Bay? It's half an acre.");
			if (!handoffReasons(c).includes('out-of-area')) await c.say('Can you come this week?');
			if (!handoffReasons(c).includes('out-of-area')) return `no out-of-area handoff (${handoffReasons(c).join(', ')})`;
			if (offers(c).length) return 'offered times';
			afterHandoff = c;
			return (await newBookings()).length === 0 || 'booked';
		},
	},
	{
		id: '5',
		title: '2 acres',
		async run() {
			const c = convo('5 over 1 acre');
			await c.say('How much to mow my 2 acre yard at 9 Hill Rd, Birchwood?');
			return handoffReasons(c).includes('yard-over-1-acre') || `no yard-over-1-acre handoff (${handoffReasons(c).join(', ')})`;
		},
	},
	{
		id: '6',
		title: 'Exactly 1 acre',
		async run() {
			const c = convo('6 exactly 1 acre');
			await c.say('Can I get a quote for exactly 1 acre at 22 Pine Ave, Birchwood?');
			const offered = await untilOffers(c, 'What times do you have?');
			if (handoffReasons(c).length) return `handed off (${handoffReasons(c).join(', ')})`;
			if (!quoted(c, '$67.50')) return 'no $67.50 quote';
			return onDays(offered, TUE_FRI) || `times not on Tue/Fri: ${offered.join(', ')}`;
		},
	},
	{
		id: '7',
		title: 'Size unknown',
		async run() {
			const c = convo('7 size unknown');
			await c.say("Can you mow my lawn at 5 Rose Ln, Dunmore? I'm not sure how big it is.");
			if (!inputsOf(c, 'quoteJob').some((i) => i.acres === null)) await c.say("I really don't know the size.");
			if (!inputsOf(c, 'quoteJob').some((i) => i.acres === null)) return 'no quote for an unknown size';
			if (!quotes(c).some((q) => q.price === '$45')) return 'not the 1-hour rate';
			return c.replies.some((r) => ON_SITE.test(said(r))) || 'did not say it is adjusted on site';
		},
	},
	{
		id: '8',
		title: 'Haggling',
		async run() {
			const c = convo('8 haggling');
			await c.say("Your prices are too high. Do my half acre in Ashford for $30 and you've got a deal.");
			if (!handoffReasons(c).includes('haggling')) return `no haggling handoff (${handoffReasons(c).join(', ')})`;
			return (await newBookings()).length === 0 || 'booked';
		},
	},
	{
		id: '9',
		title: 'Complaint',
		async run() {
			const c = convo('9 complaint');
			await c.say('Dave missed a whole strip of my lawn last week and left clippings all over my driveway.');
			return handoffReasons(c).includes('complaint') || `no complaint handoff (${handoffReasons(c).join(', ')})`;
		},
	},
	{
		id: '10',
		title: '"Next Tuesday"',
		async run() {
			const c = convo('10 next Tuesday');
			const days = ((2 - weekday(today) + 6) % 7) + 1;
			const tuesday = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
			await c.say("Hi, I'm Lee Park. Can you mow next Tuesday? It's half an acre at 8 Fen Ct, Dunmore.");
			await untilOffers(c, 'What times do you have that Tuesday?');
			const booking = await untilBooked(c, ['The Tuesday time works for me.', 'Yes, please book the Tuesday time.']);
			if (!booking) return 'no booking';
			return booking.start.startsWith(tuesday) || `booked ${booking.start}, next Tuesday is ${tuesday}`;
		},
	},
];

// --- must-pass turns -------------------------------------------------------------

let afterHandoff: Convo | undefined;
const mustPass: Result[] = [];
function check(id: string, ok: boolean, why: string, reply?: Message): void {
	mustPass.push({ id, pass: ok, why: ok ? '' : `${why} (desk said: ${said(reply)})` });
}

/** One off-topic text: the poem is the one the desk once wrote instead of declining (more would cost 2 texts each). */
const OFF_TOPIC = ['Write me a poem about cats.'];

async function mustPassTurns(): Promise<void> {
	if (selected('greeting')) {
		const c = convo('greeting and price question');
		const hello = await c.say('Hi there!');
		check('greeting: no tool call', !anyTool(hello), 'called a tool', hello);
		check('greeting: no intake questions', !/address|acre|yard/i.test(said(hello)), 'asked for booking details', hello);
		const prices = await c.say('What do you charge for mowing?');
		check('price question: not haggling', !usedTool(prices, 'handoffToDave'), 'handed off', prices);
		check('price question: gives $45', said(prices).includes('$45'), 'no price', prices);
	}
	if (selected('4') && afterHandoff) {
		const after = await afterHandoff.say('Can you tell me your price table?');
		check('after a handoff: no second handoff', !usedTool(after, 'handoffToDave'), 'handed off again', after);
		check('after a handoff: answers', !said(after).includes(HANDOFF_LINE) && said(after).includes('$45'), 'repeated the handoff line or gave no prices', after);
	}
	if (selected('offtopic')) {
		for (const body of OFF_TOPIC) {
			const c = convo(`off-topic: ${body}`);
			const reply = await c.say(body);
			const short = said(reply).length <= 220;
			check(`off-topic "${body}": declined`, !anyTool(reply) && short && /lawn|mow/i.test(said(reply)), 'not a one-line decline about lawn mowing', reply);
			const next = await c.say('How much to mow half an acre?');
			check(`off-topic "${body}": next lawn question answered`, said(next).includes('$45'), 'no answer', next);
		}
	}
}

// --- style checks on every reply ----------------------------------------------------

const PRICE_TABLE = ['45', '67.50'];
const warnings: string[] = [];
function styleProblems(c: Convo): string[] {
	const allowed = new Set(PRICE_TABLE);
	const seen = JSON.stringify(c.replies.flatMap((r) => r.parts.filter((p) => p.type === 'dynamic-tool').map((p) => p.output)));
	for (const source of [seen, ...c.customerTexts]) for (const m of source.matchAll(/\$\s?(\d+(?:\.\d{2})?)/g)) allowed.add(m[1]);
	const problems: string[] = [];
	for (const reply of c.replies) {
		const t = said(reply);
		if (/<\/?think>/i.test(t)) problems.push(`think tag: ${t}`);
		if (/(^|\n)\s*([-*•]|\d+[.)])\s+\S/.test(t)) problems.push(`list: ${t}`);
		if (/[=×→]/.test(t)) problems.push(`symbol: ${t}`);
		if (/\bg\d+-\d+\b/.test(t)) problems.push(`internal booking id: ${t}`);
		const amounts = [...t.matchAll(/\$\s?(\d+(?:\.\d{2})?)/g)].map((m) => m[1]);
		const invented = amounts.filter((a) => !allowed.has(a));
		if (invented.length) problems.push(`amount not from the tools: $${invented.join(', $')} in: ${t}`);
		if (amounts.some((a) => PRICE_TABLE.includes(a)) && !ON_SITE.test(t)) {
			warnings.push(`(${c.id}) price without "may change on site": ${t}`);
		}
	}
	return problems;
}

// --- run ---------------------------------------------------------------------------

const results: Result[] = [];
for (const c of cases.filter((x) => selected(x.id))) {
	try {
		const outcome = await c.run();
		results.push({ id: `${c.id} ${c.title}`, pass: outcome === true, why: outcome === true ? '' : outcome });
	} catch (error) {
		results.push({ id: `${c.id} ${c.title}`, pass: false, why: `error: ${(error as Error).message}` });
	}
}
try {
	await mustPassTurns();
} catch (error) {
	mustPass.push({ id: 'must-pass turns', pass: false, why: `error: ${(error as Error).message}` });
}
for (const c of conversations) {
	for (const problem of styleProblems(c)) mustPass.push({ id: `style (${c.id})`, pass: false, why: problem });
}

const score = results.filter((r) => r.pass).length;
console.log(`\n# Result — ${today}, generation ${generation}`);
for (const r of results) console.log(`${r.pass ? '✓' : '✗'} ${r.id}${r.why ? ` — ${r.why}` : ''}`);
console.log(`\nScore: ${score}/${results.length}`);
const replies = conversations.flatMap((c) => c.replies);
const reasoning = replies.flatMap((r) => r.parts.filter((p) => p.type === 'reasoning').map((p) => p.text?.length ?? 0));
const perReply = replies.length ? Math.round(reasoning.reduce((a, n) => a + n, 0) / replies.length) : 0;
console.log(`Reasoning: ${perReply} characters per reply on average (${replies.length} replies)`);
const failed = mustPass.filter((r) => !r.pass);
console.log(`Must-pass: ${mustPass.length - failed.length}/${mustPass.length} passed`);
for (const r of failed) console.log(`✗ ${r.id} — ${r.why}`);
// A missing on-site note is reported, not failed (owner, 2026-11-14): the model drops it
// now and then, and the quote tools return the note with every price.
console.log(`Warnings: ${warnings.length}`);
for (const w of warnings) console.log(`! ${w}`);
const full = results.length === cases.length;
if ((full && score < 9) || (!full && score < results.length) || failed.length) exit(1);
