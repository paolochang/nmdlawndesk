import type { Town } from './rules.ts';

/** Local wall-clock range, `YYYY-MM-DDTHH:mm`; `end` is exclusive. */
export interface TimeRange {
	start: string;
	end: string;
}

export interface Booking extends TimeRange {
	id: string;
	name: string;
	address: string;
	town: Town;
	durationMinutes: number;
	priceCents: number;
	/** How the price was worked out, e.g. `Sarah Lee · 45 Oak Rd, Ashford · 0.5 acre → 1 h × $45 = $45`. */
	basis: string;
}
