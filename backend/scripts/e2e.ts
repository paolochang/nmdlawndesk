// E2E score (build-plan §16, ROADMAP M3): the 10 scripted customer texts, scored on
// tool outcomes and the calendar rather than wording, plus must-pass turns (greeting,
// price question, a question after a handoff, off-topic texts) and style checks on
// every desk reply (think tags, lists, symbols, internal ids, invented amounts, a
// booking claimed without bookSlot). A price without the on-site note, a line break,
// or a first reply without a thank-you is a warning only. Exits non-zero below 9/10 or
// on any must-pass failure.
//
//   npx vite dev --port 8787 --strictPort        # in another terminal
//   ONLY=1 ACCESS_CODE=... NICKNAME=... node scripts/e2e.ts   # only the scope the owner asked for
//   (subset ids: 1-10, greeting, flow, policy, sqft, fence, offtopic; 4 also runs the after-handoff turn)
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
import { dollars } from '../src/domain/quote.ts';
import { RULES } from '../src/domain/rules.ts';

const { ACCESS_CODE, NICKNAME } = env;
if (!ACCESS_CODE || !NICKNAME) {
	console.error('Set ACCESS_CODE and NICKNAME (an allowlisted test nickname).');
	exit(1);
}
// Live agent tests run only when the owner asks, for the scope they name, one example each
// (owner, 2026-11-15: a findSlots loop burned the daily Workers AI allowance). No ONLY, no run.
if (!env.ONLY) {
	console.error('Set ONLY to the scope the owner asked for (e.g. ONLY=1 for one findSlots booking). A full run is never started by default.');
	exit(1);
}
const only = env.ONLY.split(',').map((s) => s.trim());
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
	phone: string;
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
		phone,
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
const offers = (c: Convo) =>
	outputsOf(c, 'findSlots').flatMap((p) => (p.output as { slots?: { start: string }[] }).slots ?? []).map((s) => s.start);
/** Reasons of handoffs that went through: a refused call (`ok: false`, e.g. missing acres) texted no one. */
const handoffReasons = (c: Convo) =>
	outputsOf(c, 'handoffToDave')
		.filter((p) => (p.output as { ok?: boolean }).ok === true)
		.map((p) => (p.input as { reason?: string }).reason);
const weekday = (start: string) => new Date(`${start.slice(0, 10)}T00:00:00Z`).getUTCDay();
const onDays = (starts: string[], days: number[]) => starts.length >= 2 && starts.every((s) => days.includes(weekday(s)));
/** "may change on site", "changing on site", "adjusted on site" … */
const ON_SITE = /(chang|adjust)\w* on site/i;
/** The price table's prices, from the rules: ["$45", "$67.50"]. */
const TABLE_PRICES = RULES.priceTable.map((row) => dollars(Math.round((row.durationMinutes / 60) * RULES.hourlyRateCents)));
/**
 * The case's price reached the customer: a desk text stated it and no other table price
 * (a recited price table is not a quote, and a right quoteJob result with a wrong texted
 * price is still a wrong quote).
 */
const quoted = (c: Convo, price: string) =>
	c.replies.some((r) => said(r).includes(price) && !TABLE_PRICES.some((p) => p !== price && said(r).includes(p)));
/** Asked for what is missing: no tool call, and the text asks for the address, town, or yard size. */
const asksDetails = (m: Message | undefined) => !anyTool(m) && /address|street|town|where|how big|what size|yard size/i.test(said(m));
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
			if ((await newBookings()).length) return 'booked before the customer picked a time';
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
			const durations = outputsOf(c, 'findSlots').map((p) => (p.output as { duration?: string }).duration);
			if (!durations.includes('1.5 h')) return `times not for a 1.5 h job (${durations.join(', ')})`;
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
			if (!quoted(c, '$45')) return 'the 1-hour rate was not texted';
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
			const first = await c.say('Dave missed a whole strip of my lawn last week and left clippings all over my driveway.');
			// Owner E2E (2026-11-14): Dave needs to know whose job it was, so the desk asks first.
			if (handoffReasons(c).length) return 'handed off before asking for the name and address';
			if (!/name|address|street/i.test(said(first))) return 'did not ask for the name and address';
			await c.say("I'm Nora Hill, 21 Moor Ln, Clearwater.");
			if (!handoffReasons(c).includes('complaint')) return `no complaint handoff (${handoffReasons(c).join(', ')})`;
			const { daveTexts } = await api<{ daveTexts: { text: string }[] }>(`/calendar/${visitorId}`, { token });
			const alert = daveTexts.find((t) => t.text.startsWith(`Please call ${c.phone} (a complaint).`));
			return (alert?.text.includes('Nora Hill') && alert.text.includes('21 Moor Ln')) || `Dave's text lacks the name and address (${alert?.text})`;
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
			const offered = await untilOffers(c, 'What times do you have that Tuesday?');
			if (offered.length === 0) return 'no times from findSlots';
			if ((await newBookings()).length) return 'booked before the customer picked a time';
			const booking = await untilBooked(c, ['The Tuesday time works for me.', 'Yes, please book the Tuesday time.']);
			if (!booking) return 'no booking';
			if (!offered.includes(booking.start)) return `booked ${booking.start}, which findSlots never offered (${offered.join(', ')})`;
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
		check('greeting: thanks them for reaching out', /thank/i.test(said(hello)), 'no thank-you', hello);
		if (!/assistant/i.test(said(hello))) warnings.push(`(greeting) first reply does not say it is Dave's booking assistant: ${said(hello)}`);
		const prices = await c.say('What do you charge for mowing?');
		check('price question: not haggling', !usedTool(prices, 'handoffToDave'), 'handed off', prices);
		check('price question: gives $45', said(prices).includes('$45'), 'no price', prices);
	}
	if (selected('4') && !afterHandoff) {
		check('after a handoff: answers', false, 'not run: case 4 did not hand off');
	} else if (selected('4') && afterHandoff) {
		const after = await afterHandoff.say('Can you tell me your price table?');
		check('after a handoff: no second handoff', !usedTool(after, 'handoffToDave'), 'handed off again', after);
		check('after a handoff: answers', !said(after).includes(HANDOFF_LINE) && said(after).includes('$45'), 'repeated the handoff line or gave no prices', after);
	}
	// Owner review (2026-11-14): a side question mid-booking gets an answer, not the times
	// again, and "neither works" gets new times from findSlots.
	if (selected('flow')) {
		const c = convo('flow: side question, then neither works');
		await c.say("I'd like a quote. It's about half an acre at 14 Birch Ave, Birchwood.");
		const first = await untilOffers(c, 'What times do you have?');
		const side = await c.say('How long does the job take?');
		check('side question: answered', /hour/i.test(said(side)) && !CLAIMS_BOOKING.test(said(side)), 'did not say how long it takes', side);
		const neither = await c.say("Neither of those works for me, sorry. Anything later?");
		const later = toolOutputs(neither, 'findSlots').flatMap((p) => (p.output as { slots?: { start: string }[] }).slots ?? []).map((x) => x.start);
		check(
			'neither works: new times from findSlots',
			first.length > 0 && later.length > 0 && later.every((start) => !first.includes(start)),
			`no new findSlots times (first ${first.join(', ')}; then ${later.join(', ')})`,
			neither,
		);
	}
	// Owner review (2026-11-14): a lawn question the rules do not answer goes to Dave, not a made-up policy.
	if (selected('policy')) {
		const c = convo('policy: payment question');
		const pay = await c.say('Do you take credit cards?');
		check('payment question: handed to Dave', handoffReasons(c).includes('other'), 'no handoff with reason other', pay);
	}
	// Owner review (2026-11-14): square feet are converted, not guessed.
	if (selected('sqft')) {
		const c = convo('sqft: 5,000 sq ft');
		await c.say('How much to mow a 5,000 sq ft yard at 3 Cedar Ct, Dunmore?');
		check('square feet: quoted as up to half an acre', quoted(c, '$45'), 'no $45 quote for 5,000 sq ft', c.replies.at(-1));
	}
	// Owner E2E (2026-11-14): damage after Dave's visit, not blaming him outright, is a complaint (not "another service").
	if (selected('fence')) {
		const c = convo('fence: damage after the visit');
		const first = await c.say('Hi, I found my fence got damaged after Dave finished mowing my backyard.');
		check('fence damage: treated as a complaint', !anyTool(first) && /name|address|street/i.test(said(first)), 'did not ask for the name and address', first);
		await c.say('Ben, 9 Aspen Ct, Birchwood');
		check('fence damage: handed to Dave', handoffReasons(c).includes('complaint'), 'no complaint handoff', c.replies.at(-1));
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

const PRICE_TABLE = TABLE_PRICES.map((p) => p.slice(1));
/** A slot label as the desk texts it, e.g. "Mon Nov 16". */
const TIME_LABEL = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}\b/g;
/** "You're booked", "booking confirmed", "I've scheduled you" … (owner E2E 2026-11-14: texted with no bookSlot call). */
const CLAIMS_BOOKING = /\b(you'?re|you are|you'?ve been|you have been|it'?s|it is|that'?s|that is)\s+(all\s+)?(booked|scheduled|confirmed|reserved)\b|\bbooking (is )?confirmed\b|\bI'?ve (booked|scheduled|reserved)\b|\bI have (booked|scheduled|reserved)\b/i;
/** Dollar amounts in a text, "$45.00" read as "45" and "$1,000" as "1000". */
const amountsIn = (text: string) => [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d{2})?)/g)].map((m) => m[1].replaceAll(',', '').replace(/\.00$/, ''));
const warnings: string[] = [];
function styleProblems(c: Convo): string[] {
	const allowed = new Set(PRICE_TABLE);
	const seen = JSON.stringify(c.replies.flatMap((r) => r.parts.filter((p) => p.type === 'dynamic-tool').map((p) => p.output)));
	for (const source of [seen, ...c.customerTexts]) for (const amount of amountsIn(source)) allowed.add(amount);
	const problems: string[] = [];
	// Owner E2E (2026-11-14): the first reply of a conversation opens with a thank-you.
	if (c.replies[0] && !/thank/i.test(said(c.replies[0]))) warnings.push(`(${c.id}) first reply has no thank-you: ${said(c.replies[0])}`);
	// …and only that one (owner E2E: the second reply thanked them again).
	for (const reply of c.replies.slice(1)) {
		if (/thanks? (you )?for (reaching out|contacting|texting)/i.test(said(reply))) problems.push(`thanked for reaching out again: ${said(reply)}`);
	}
	let pricedBefore = false;
	let previousTimes = new Set<string>();
	for (const [index, reply] of c.replies.entries()) {
		const t = said(reply);
		const booked = toolOutputs(reply, 'bookSlot').some((p) => (p.output as { ok?: boolean }).ok === true);
		if (CLAIMS_BOOKING.test(t) && !booked) problems.push(`says it is booked, but bookSlot did not book in this reply: ${t}`);
		if (/<\/?think>/i.test(t)) problems.push(`think tag: ${t}`);
		if (/(^|\n)\s*([-*•]|\d+[.)])\s+\S/.test(t)) problems.push(`list: ${t}`);
		if (/\*\*|__/.test(t)) problems.push(`markdown: ${t}`);
		if (/\n/.test(t.trim())) warnings.push(`(${c.id}) line break: ${t}`);
		if (/[=×→]/.test(t)) problems.push(`symbol: ${t}`);
		if (/\bg\d+-\d+\b/.test(t)) problems.push(`internal booking id: ${t}`);
		const amounts = amountsIn(t);
		const invented = amounts.filter((a) => !allowed.has(a));
		if (invented.length) problems.push(`amount not from the tools: $${invented.join(', $')} in: ${t}`);
		// The on-site note belongs to the first price and the booking confirmation (owner review 2026-11-14).
		const firstPrice = amounts.some((a) => PRICE_TABLE.includes(a)) && !pricedBefore;
		if ((firstPrice || booked) && !ON_SITE.test(t)) warnings.push(`(${c.id}) ${booked ? 'booking confirmation' : 'first price'} without "may change on site": ${t}`);
		if (amounts.some((a) => PRICE_TABLE.includes(a))) pricedBefore = true;
		// Repeating the previous text's times or price unasked reads like a template (owner review).
		const times = new Set(t.match(TIME_LABEL) ?? []);
		const asked = /time|when|avail|slot|again|which|price|cost|how much/i.test(c.customerTexts[index] ?? '');
		if (index > 0 && !asked && times.size > 0 && [...times].every((x) => previousTimes.has(x))) warnings.push(`(${c.id}) repeated the times: ${t}`);
		previousTimes = times;
	}
	return problems;
}

// --- run ---------------------------------------------------------------------------

const results: Result[] = [];
for (const c of cases.filter((x) => selected(x.id))) {
	try {
		await newBookings(); // a stray booking belongs to the case that made it, not the next one to look
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
for (const c of conversations) {
	const chars = c.replies.map((r) => r.parts.filter((p) => p.type === 'reasoning').reduce((n, p) => n + (p.text?.length ?? 0), 0));
	if (chars.length) console.log(`  reasoning ${String(Math.round(chars.reduce((n, x) => n + x, 0) / chars.length)).padStart(5)} chars/reply, max ${Math.max(...chars)} — ${c.id}`);
}
const failed = mustPass.filter((r) => !r.pass);
console.log(`Must-pass: ${mustPass.length - failed.length}/${mustPass.length} passed`);
for (const r of failed) console.log(`✗ ${r.id} — ${r.why}`);
// A missing on-site note is reported, not failed (owner, 2026-11-14): the model drops it
// now and then, and the quote tools return the note with every price.
console.log(`Warnings: ${warnings.length}`);
for (const w of warnings) console.log(`! ${w}`);
const full = results.length === cases.length;
if ((full && score < 9) || (!full && score < results.length) || failed.length) exit(1);
