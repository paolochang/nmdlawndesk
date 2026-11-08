// Whether a value the desk wants to book came from the customer's own texts
// (build-plan §13): the desk may not guess a name or an address.

/** Lowercase words: letters and digits only, so punctuation and spacing never matter. */
function words(text: string): string[] {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

/** Street types that a customer and the desk may write either way (`Rd` / `Road`). */
const STREET_TYPES = new Set([
	'rd', 'road', 'st', 'street', 'ave', 'av', 'avenue', 'ln', 'lane', 'dr', 'drive', 'ct', 'court',
	'way', 'pl', 'place', 'blvd', 'boulevard', 'ter', 'terrace', 'cir', 'circle', 'hwy', 'highway', 'pkwy', 'parkway',
]);

/** The name, word for word and in order, appears in one of the customer's texts. */
export function nameTexted(texts: readonly string[], name: string): boolean {
	const wanted = words(name);
	if (!wanted.length) return false;
	return texts.some((text) => {
		const said = words(text);
		return said.some((_, i) => wanted.every((word, j) => said[i + j] === word));
	});
}

/** Every word of the street address but its street type appears in the customer's texts. */
export function addressTexted(texts: readonly string[], address: string): boolean {
	const wanted = words(address).filter((word) => !STREET_TYPES.has(word));
	if (!wanted.length) return false;
	const said = new Set(texts.flatMap(words));
	return wanted.every((word) => said.has(word));
}
