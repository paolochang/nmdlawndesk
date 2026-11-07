// Calendar arithmetic on zone-less local dates (`YYYY-MM-DD`) and date-times
// (`YYYY-MM-DDTHH:mm`). UTC is used only as a neutral calendar, never as a zone.

import type { Weekday } from './rules.ts';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

function dateToUtc(date: string): number {
	const m = DATE.exec(date);
	const ms = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : Number.NaN;
	if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
		throw new RangeError(`Expected a date YYYY-MM-DD, got ${JSON.stringify(date)}`);
	}
	return ms;
}

export function weekdayOf(date: string): Weekday {
	return new Date(dateToUtc(date)).getUTCDay() as Weekday;
}

export function addDays(date: string, days: number): string {
	return new Date(dateToUtc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** `HH:mm` → minutes after midnight. */
export function toMinutes(time: string): number {
	const [h, m] = time.split(':').map(Number);
	return h * 60 + m;
}

export function splitDateTime(dateTime: string): { date: string; minutes: number } {
	const m = DATE_TIME.exec(dateTime);
	const hours = m ? +m[2] : Number.NaN;
	const mins = m ? +m[3] : Number.NaN;
	if (!m || !(hours < 24) || !(mins < 60)) {
		throw new RangeError(`Expected a date-time YYYY-MM-DDTHH:mm, got ${JSON.stringify(dateTime)}`);
	}
	dateToUtc(m[1]);
	return { date: m[1], minutes: hours * 60 + mins };
}

export function joinDateTime(date: string, minutes: number): string {
	const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
	const mm = String(minutes % 60).padStart(2, '0');
	return `${date}T${hh}:${mm}`;
}

export function assertDate(date: string): void {
	dateToUtc(date);
}
