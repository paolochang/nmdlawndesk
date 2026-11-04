// Dave's business rules (build-plan §4). One plain, JSON-serializable object:
// the agent reads it through tools and the UI shows it on Dave's side (/config).
//
// Times are Dave's local wall-clock time. A date is `YYYY-MM-DD`, a date-time is
// `YYYY-MM-DDTHH:mm`, with no time zone: Dave works in one place.

export const TOWNS = ['Ashford', 'Clearwater', 'Birchwood', 'Dunmore'] as const;
export type Town = (typeof TOWNS)[number];

/** 0 = Sunday … 6 = Saturday, as `Date#getUTCDay` returns. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const RULES = {
	/** The simulator's fixed "today" (a Sunday): presets and slot search start here. */
	demoDate: '2026-11-15',
	hours: { open: '08:00', close: '13:00' },
	/** Bookings start on this grid, counted from opening time. */
	slotStepMinutes: 30,
	/** How far ahead slot search looks. */
	searchDays: 14,
	townGroups: [
		{ weekdays: [1, 4] as Weekday[], towns: ['Ashford', 'Clearwater'] as Town[] },
		{ weekdays: [2, 5] as Weekday[], towns: ['Birchwood', 'Dunmore'] as Town[] },
	],
	hourlyRateCents: 4500,
	/** Upper bound in acres (inclusive) → job length. Anything larger is handed off. */
	priceTable: [
		{ maxAcres: 0.5, durationMinutes: 60 },
		{ maxAcres: 1, durationMinutes: 90 },
	],
	/** Unknown yard size: quote this length and say it is adjusted on site. */
	unknownSizeDurationMinutes: 60,
};

/** Matches a town name ignoring case and surrounding spaces; misspellings are the agent's job. */
export function resolveTown(name: string): Town | undefined {
	const key = name.trim().toLowerCase();
	return TOWNS.find((town) => town.toLowerCase() === key);
}

export function townWeekdays(town: Town): Weekday[] {
	const group = RULES.townGroups.find((g) => g.towns.includes(town));
	if (!group) throw new Error(`No weekday group for ${town}`);
	return group.weekdays;
}
