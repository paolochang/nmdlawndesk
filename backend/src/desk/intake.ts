// What the customer's texts already say about a quote (#22, build-plan §16): one of Dave's
// towns, a street address, and a yard size or "not sure". The agent uses it to send the
// desk back to quoteJob and findSlots when it asked again for something it had.
import { TOWNS, type Town } from '../domain/rules.ts';

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
	/\b\d{1,5}\s+(?:[a-z][a-z.'-]*\s+){1,3}?(?:st|street|rd|road|ave|avenue|ln|lane|ct|court|way|dr|drive|blvd|boulevard|pl|place|cir|circle|ter|terrace|pkwy|parkway|hwy|highway)\b\.?/i;

function streetIn(text: string): string | undefined {
	return STREET.exec(text)?.[0].replace(/\.$/, '');
}

const UNKNOWN = /\b(?:not sure|unsure|no idea|no clue|not certain|don'?t know|do not know|dunno)\b/i;
const FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };
const WORDS: [RegExp, number][] = [
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
	const fraction = /(\d)\s*\/\s*(\d)\s*(?:of\s+an?\s+)?acres?\b/i.exec(text);
	if (fraction) return Number(fraction[1]) / Number(fraction[2]);
	const glyph = /([¼½¾])\s*acres?\b/.exec(text);
	if (glyph) return FRACTIONS[glyph[1]];
	const number = /(\d+(?:\.\d+)?)\s*-?\s*acres?\b/i.exec(text);
	if (number) return Number(number[1]);
	for (const [pattern, acres] of WORDS) if (pattern.test(text)) return acres;
	if (UNKNOWN.test(text)) return null;
	return undefined;
}

/** Every detail a quote needs, from the customer's texts (the latest text first), or `undefined`. */
export function detailsGiven(texts: readonly string[]): GivenDetails | undefined {
	const latestFirst = [...texts].reverse();
	const town = latestFirst.map(townIn).find((t) => t !== undefined);
	const street = latestFirst.map(streetIn).find((s) => s !== undefined);
	const acres = latestFirst.map(acresIn).find((a) => a !== undefined);
	if (!town || !street || acres === undefined) return undefined;
	return { town, street, acres };
}

export interface RetryInput {
	/** Tools this response called so far (`useAgentFinish` `response.toolCalls`). */
	toolCalls: readonly string[];
	details: GivenDetails | undefined;
	/** Whether findSlots has offered times in this conversation. */
	offered: boolean;
	/** The customer text count the desk was last sent back at, and the count now. */
	retriedAt: number;
	texts: number;
}

/** Whether to send the desk back to quoteJob and findSlots: once per customer text, never in a loop. */
export function shouldRetryForDetails({ toolCalls, details, offered, retriedAt, texts }: RetryInput): boolean {
	if (!details || offered || retriedAt === texts) return false;
	return !toolCalls.some((tool) => tool === 'findSlots' || tool === 'bookSlot' || tool === 'handoffToDave');
}

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
