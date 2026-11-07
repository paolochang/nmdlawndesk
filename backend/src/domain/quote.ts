import { RULES } from './rules.ts';

export type Quote =
	| { kind: 'quote'; durationMinutes: number; priceCents: number; basis: string }
	| { kind: 'handoff'; reason: string };

/** Prices a job from the yard size (build-plan §4). Throws RangeError on a non-positive or non-finite size. */
export function quote(acres: number | 'unknown'): Quote {
	if (acres === 'unknown') {
		const job = priced(RULES.unknownSizeDurationMinutes);
		return { ...job, basis: `size unknown → ${job.basis}, adjusted on site` };
	}
	if (!Number.isFinite(acres) || acres <= 0) {
		throw new RangeError(`Yard size must be a positive number of acres, got ${acres}`);
	}
	const row = RULES.priceTable.find((r) => acres <= r.maxAcres);
	if (!row) return { kind: 'handoff', reason: 'yard over 1 acre' };
	const job = priced(row.durationMinutes);
	return { ...job, basis: `${acres} acre → ${job.basis}` };
}

function priced(durationMinutes: number) {
	const hours = durationMinutes / 60;
	const priceCents = Math.round(hours * RULES.hourlyRateCents);
	return {
		kind: 'quote' as const,
		durationMinutes,
		priceCents,
		basis: `${hours} h × ${dollars(RULES.hourlyRateCents)} = ${dollars(priceCents)}`,
	};
}

/** 4500 → "$45", 6750 → "$67.50". */
export function dollars(cents: number): string {
	return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
