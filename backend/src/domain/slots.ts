import { RULES, type Town, townWeekdays } from './rules.ts';
import { addDays, assertDate, joinDateTime, splitDateTime, toMinutes, weekdayOf } from './time.ts';
import type { TimeRange } from './types.ts';

export type SlotCheck =
	| { ok: true; slot: TimeRange }
	| { ok: false; reason: 'wrong-weekday' | 'outside-hours' | 'past' | 'overlap' };

const OPEN = toMinutes(RULES.hours.open);
const CLOSE = toMinutes(RULES.hours.close);

/**
 * Open slots for a job in `town`: the earliest free start on each of the town's
 * weekdays, from `from` (inclusive) for `days` days, at most `limit` slots. A job
 * must end by closing time and must not overlap any booking (Dave is one person,
 * so bookings in every town count). Back-to-back jobs are fine.
 */
export function findSlots({
	town,
	durationMinutes,
	from,
	bookings,
	limit = 2,
	days = RULES.searchDays,
}: {
	town: Town;
	durationMinutes: number;
	from: string;
	bookings: readonly TimeRange[];
	limit?: number;
	days?: number;
}): TimeRange[] {
	assertDuration(durationMinutes);
	const weekdays = townWeekdays(town);
	const slots: TimeRange[] = [];
	for (let d = 0; d < days && slots.length < limit; d++) {
		const date = addDays(from, d);
		if (!weekdays.includes(weekdayOf(date))) continue;
		for (let start = OPEN; start + durationMinutes <= CLOSE; start += RULES.slotStepMinutes) {
			const slot = { start: joinDateTime(date, start), end: joinDateTime(date, start + durationMinutes) };
			if (!bookings.some((b) => overlaps(b, slot))) {
				slots.push(slot);
				break;
			}
		}
	}
	return slots;
}

/** Whether a job starting at `start` may be booked. Throws RangeError on malformed input. */
export function checkSlot({
	town,
	start,
	durationMinutes,
	from,
	bookings,
}: {
	town: Town;
	start: string;
	durationMinutes: number;
	from: string;
	bookings: readonly TimeRange[];
}): SlotCheck {
	assertDuration(durationMinutes);
	assertDate(from);
	const { date, minutes } = splitDateTime(start);
	if (date < from) return { ok: false, reason: 'past' };
	if (!townWeekdays(town).includes(weekdayOf(date))) return { ok: false, reason: 'wrong-weekday' };
	if (minutes < OPEN || minutes + durationMinutes > CLOSE) return { ok: false, reason: 'outside-hours' };
	const slot = { start, end: joinDateTime(date, minutes + durationMinutes) };
	if (bookings.some((b) => overlaps(b, slot))) return { ok: false, reason: 'overlap' };
	return { ok: true, slot };
}

/** Same-format date-time strings compare in time order. */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
	return a.start < b.end && b.start < a.end;
}

function assertDuration(durationMinutes: number): void {
	if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
		throw new RangeError(`Duration must be a positive whole number of minutes, got ${durationMinutes}`);
	}
}
