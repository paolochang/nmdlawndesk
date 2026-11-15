// What the customer's texts already say about a quote (#22, build-plan §16): one of Dave's
// towns, a street address, and a yard size or "not sure". The agent uses it to send the
// desk back to quoteJob and findSlots when it asked again for something it had.
import { RULES, TOWNS, type Town } from '../domain/rules.ts';

export interface GivenDetails {
	town: Town;
	street: string;
	/** Acres, or `null` when the customer said they do not know. */
	acres: number | null;
}

/** Edit distance up to 1 (one letter added, dropped, or changed), else 2. */
function closeTo(word: string, target: string): boolean {
	if (word === target) return true;
	if (Math.abs(word.length - target.length) > 1) return false;
	let i = 0;
	let j = 0;
	let edits = 0;
	while (i < word.length && j < target.length) {
		if (word[i] === target[j]) {
			i++;
			j++;
			continue;
		}
		if (++edits > 1) return false;
		if (word.length > target.length) i++;
		else if (word.length < target.length) j++;
		else {
			i++;
			j++;
		}
	}
	return edits + (word.length - i) + (target.length - j) <= 1;
}

/** One of Dave's towns named in the text; a one-letter misspelling of a 5+ letter word counts ("dunmor"). */
function townIn(text: string): Town | undefined {
	const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
	return TOWNS.find((town) => words.some((word) => word === town.toLowerCase() || (word.length >= 5 && closeTo(word, town.toLowerCase()))));
}

const STREET =
	/\b\d{1,5}\s+(?:[a-z][a-z.'-]*\s+){1,3}?(?:st|street|rd|road|ave|avenue|ln|lane|ct|court|way|dr|drive|blvd|boulevard|pl|place|cir|circle|ter|terrace|pkwy|parkway|hwy|highway)\b\.?/gi;
/** Words a street name never has: "2 dogs by the way" and "a 10 minute drive" are not addresses (holistic review of #23). */
const NOT_STREET_NAME = new Set(
	'a an the and or of to from for by at in on my your our his her their is are was am be it this that me minute minutes min mins mile miles hour hours dog dogs cat cats kid kids year years day days week weeks time times acre acres foot feet people'.split(' '),
);

/** The street addresses in a text: a number, one to three name words, and a street word. */
function streetsIn(text: string): string[] {
	return [...text.matchAll(STREET)]
		.map((match) => match[0].replace(/\.$/, '').trim())
		.filter((street) => !street.toLowerCase().split(/\s+/).slice(1, -1).some((word) => NOT_STREET_NAME.has(word)));
}

const UNKNOWN = /\b(?:not sure|unsure|no idea|no clue|not certain|don'?t know|do not know|dunno)\b/i;
/** "Not sure" counts as an unknown size only in a sentence about the size (Codex review of #23). */
const SIZE_WORDS = /\b(?:how big|how large|size|acres?|acreage|yard|lot|square f(?:ee|oo)t|sq\.?\s*ft)\b/i;
const FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };
const WORDS: [RegExp, number][] = [
	[/\b(?:an?|one)\s+acre\s+and\s+a\s+half\b/i, 1.5],
	[/\bthree[- ]quarters?\s+(?:of\s+)?(?:an?\s+)?acres?\b/i, 0.75],
	[/\b(?:a\s+)?quarter\s+(?:of\s+)?(?:an?\s+)?acres?\b/i, 0.25],
	[/\b(?:a\s+)?half\s+(?:of\s+)?(?:an?\s+)?acres?\b/i, 0.5],
	[/\b(?:an?|one)\s+acres?\b/i, 1],
];

/** The yard size in acres, `null` for "not sure", or `undefined` when the text gives none. */
function acresIn(text: string): number | null | undefined {
	const sqft = /(\d[\d,]*)\s*(?:sq\.?\s*f(?:ee)?t|square\s+f(?:ee|oo)t|sqft)\b/i.exec(text);
	// Rounded up to two places, never down, like the prompt's square-feet rule.
	if (sqft) return Math.ceil((Number(sqft[1].replaceAll(',', '')) / 43560) * 100) / 100;
	// Whole expressions only, never the tail of one (Codex review of #23: ".5" read as 5, "1 1/2" as 0.5).
	const mixed = /(?<![\d.])(\d+)\s+(\d)\s*\/\s*(\d)\s*(?:of\s+an?\s+)?acres?\b/i.exec(text);
	if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
	const fraction = /(?<![\d.])(?<!\d\s)(\d)\s*\/\s*(\d)\s*(?:of\s+an?\s+)?acres?\b/i.exec(text);
	if (fraction) return Number(fraction[1]) / Number(fraction[2]);
	const glyph = /(?<![\d.])([¼½¾])\s*acres?\b/.exec(text);
	if (glyph) return FRACTIONS[glyph[1]];
	const number = /(?<![\d.\/])(\d+(?:\.\d+)?|\.\d+)\s*-?\s*acres?\b/i.exec(text);
	if (number) return Number(number[1]);
	for (const [pattern, acres] of WORDS) if (pattern.test(text)) return acres;
	if (text.split(/(?<=[.!?])\s+/).some((sentence) => UNKNOWN.test(sentence) && SIZE_WORDS.test(sentence))) return null;
	return undefined;
}

/**
 * Every detail a quote needs, from the customer's texts (the latest text first), or
 * `undefined` when one is missing or unclear: a missed detail changes nothing, a wrong one
 * would send the desk back with it.
 */
export function detailsGiven(texts: readonly string[]): GivenDetails | undefined {
	const read = [...texts].reverse().map((text) => {
		const streets = streetsIn(text);
		// The town is looked for outside the street addresses: "52 Ashford Rd, Clearwater" is in Clearwater.
		const town = townIn(streets.reduce((rest, street) => rest.replace(street, ' '), text));
		return { town, street: streets[0], acres: acresIn(text) };
	});
	const withTown = read.find((r) => r.town !== undefined);
	const town = withTown?.town;
	// A street from another text counts only if that text named no town or the same one.
	const street = withTown?.street ?? read.find((r) => r.street !== undefined && (r.town === undefined || r.town === town))?.street;
	const acres = read.map((r) => r.acres).find((a) => a !== undefined);
	if (!town || !street || acres === undefined) return undefined;
	return { town, street, acres };
}

export interface RetryInput {
	/** Tools this response called so far (`useAgentFinish` `response.toolCalls`). */
	toolCalls: readonly string[];
	details: GivenDetails | undefined;
	/** Whether findSlots has offered times in this conversation. */
	offered: boolean;
	/** Whether handoffToDave has handed this customer to Dave (holistic review of #23). */
	handedOff: boolean;
	/** The customer text count the desk was last sent back at, and the count now. */
	retriedAt: number;
	texts: number;
}

/** Whether to send the desk back to quoteJob and findSlots: once per customer text, never in a loop. */
export function shouldRetryForDetails({ toolCalls, details, offered, handedOff, retriedAt, texts }: RetryInput): boolean {
	if (!details || offered || handedOff || retriedAt === texts) return false;
	// A yard over the price table is Dave's to price (a handoff, not a quote).
	if (details.acres !== null && details.acres > MAX_ACRES) return false;
	return !toolCalls.some((tool) => tool === 'findSlots' || tool === 'bookSlot' || tool === 'handoffToDave');
}

const MAX_ACRES = Math.max(...RULES.priceTable.map((row) => row.maxAcres));

/** The signal that sends the desk back, naming what the customer gave. */
export function detailsRetrySignal(details: GivenDetails) {
	const size = details.acres === null ? 'unknown (they do not know it; quote with acres null)' : `${details.acres} acre`;
	return {
		kind: 'signal' as const,
		type: 'lawn-desk.details-given',
		tagName: 'details-given',
		body: `The customer already gave every detail: town ${details.town}, street ${details.street}, yard size ${size}. Do not ask for them again. Call quoteJob and findSlots now, then send the price (with the on-site note) and the two times in one text.`,
	};
}
