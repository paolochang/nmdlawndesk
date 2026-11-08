// How times, lengths, and prices read in texts (the customer's and Dave's).

import { WEEKDAY_NAMES } from './rules.ts';
import { splitDateTime, weekdayOf } from './time.ts';
import type { TimeRange } from './types.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Thu Nov 19, 8:00-9:30 AM`, `Tue Nov 17, 11:30 AM-12:30 PM`. */
export function slotLabel({ start, end }: TimeRange): string {
	const from = splitDateTime(start);
	const to = splitDateTime(end);
	const [, month, day] = from.date.split('-').map(Number);
	const sameHalf = from.minutes < 720 === to.minutes < 720;
	const times = `${clock(from.minutes, !sameHalf)}-${clock(to.minutes, true)}`;
	return `${WEEKDAY_NAMES[weekdayOf(from.date)]} ${MONTHS[month - 1]} ${day}, ${times}`;
}

/** `1 h`, `1.5 h`. */
export function hours(minutes: number): string {
	return `${minutes / 60} h`;
}

function clock(minutes: number, meridiem: boolean): string {
	const h = Math.floor(minutes / 60);
	const text = `${h % 12 || 12}:${String(minutes % 60).padStart(2, '0')}`;
	return meridiem ? `${text} ${h < 12 ? 'AM' : 'PM'}` : text;
}
