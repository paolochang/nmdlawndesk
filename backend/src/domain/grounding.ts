// Whether a value the desk wants to book came from the customer's own texts
// (build-plan §13): the desk may not guess a name or an address.

/** Street types a customer and the desk may write either way, each mapped to one form. */
export const STREET_TYPES: Record<string, string> = {
	road: 'rd', rd: 'rd', street: 'st', st: 'st', avenue: 'ave', ave: 'ave', av: 'ave', lane: 'ln', ln: 'ln',
	drive: 'dr', dr: 'dr', court: 'ct', ct: 'ct', way: 'way', place: 'pl', pl: 'pl', boulevard: 'blvd', blvd: 'blvd',
	terrace: 'ter', ter: 'ter', circle: 'cir', cir: 'cir', highway: 'hwy', hwy: 'hwy', parkway: 'pkwy', pkwy: 'pkwy',
};

/**
 * Lowercase words of letters and digits. A dot inside a number stays (`0.5` is one
 * word, so it never grounds a house number `5`); other punctuation separates words.
 */
function words(text: string): string[] {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.split(/[^\p{L}\p{N}.]+/u)
		.map((word) => word.replace(/^\.+|\.+$/g, ''))
		.filter(Boolean);
}

/** `wanted` appears word for word, in order, inside one of `texts`. */
function inOneText(texts: readonly string[], wanted: readonly string[], form = (word: string) => word): boolean {
	if (!wanted.length) return false;
	return texts.some((text) => {
		const said = words(text).map(form);
		return said.some((_, i) => wanted.every((word, j) => said[i + j] === word));
	});
}

const streetForm = (word: string) => STREET_TYPES[word] ?? word;

/**
 * The name, word for word and in order, appears in one of the customer's texts. A
 * name needs a letter, and is never "Dave" or a word of the address being booked.
 */
export function nameTexted(texts: readonly string[], name: string, address = ''): boolean {
	const wanted = words(name);
	if (!wanted.some((word) => /\p{L}/u.test(word))) return false;
	const addressWords = new Set(words(address));
	if (wanted.every((word) => word === 'dave' || addressWords.has(word))) return false;
	return inOneText(texts, wanted);
}

/**
 * The street address, word for word and in order, appears in one of the customer's
 * texts; `Rd` and `Road` (and the other street types) count as the same word. A
 * `town` the desk wrote after the street is left out: the town is checked on its own,
 * and may be spelled right where the customer misspelled it (owner E2E).
 */
export function addressTexted(texts: readonly string[], address: string, town = ''): boolean {
	const street = words(address);
	const townWords = words(town);
	const tail = street.slice(-townWords.length);
	const withoutTown =
		townWords.length && street.length > townWords.length && tail.every((word, i) => word === townWords[i])
			? street.slice(0, -townWords.length)
			: street;
	return inOneText(texts, withoutTown.map(streetForm), streetForm);
}
