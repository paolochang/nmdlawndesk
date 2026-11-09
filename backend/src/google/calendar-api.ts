import type { Booking } from '../domain/types.ts';

const BASE = 'https://www.googleapis.com/calendar/v3';

/** An HTTP error from the Calendar API; `status` 401 means the access token expired. */
export class CalendarApiError extends Error {
	constructor(readonly status: number) {
		super(`Google Calendar API ${status}`);
	}
}

/** The few Calendar API calls the sync needs, over an injected `fetch`. */
export class CalendarApi {
	constructor(
		private readonly fetcher: typeof fetch,
		private readonly accessToken: string,
	) {}

	async createCalendar(summary: string, timeZone: string): Promise<string> {
		const body = await this.#call('POST', '/calendars', { summary, timeZone });
		return (body as { id: string }).id;
	}

	async insertEvent(calendarId: string, event: GoogleEvent): Promise<string> {
		const body = await this.#call('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, event);
		return (body as { id: string }).id;
	}

	/** An event already gone (404, 410) counts as deleted. */
	async deleteEvent(calendarId: string, eventId: string): Promise<void> {
		await this.#call('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, undefined, [404, 410]);
	}

	/** A calendar already gone (404, 410) counts as deleted. */
	async deleteCalendar(calendarId: string): Promise<void> {
		await this.#call('DELETE', `/calendars/${encodeURIComponent(calendarId)}`, undefined, [404, 410]);
	}

	async #call(method: string, path: string, json?: unknown, gone: number[] = []): Promise<unknown> {
		const res = await this.fetcher(`${BASE}${path}`, {
			method,
			headers: { Authorization: `Bearer ${this.accessToken}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
			...(json ? { body: JSON.stringify(json) } : {}),
		});
		if (gone.includes(res.status)) return null;
		if (!res.ok) throw new CalendarApiError(res.status);
		return res.status === 204 ? null : res.json();
	}
}

export interface GoogleEvent {
	summary: string;
	description: string;
	start: { dateTime: string; timeZone: string };
	end: { dateTime: string; timeZone: string };
	extendedProperties: { private: { bookingId: string } };
}

/** The Google event for one booking: the same title and details as Dave's calendar (build-plan §14). */
export function eventFor(booking: Booking, timeZone: string): GoogleEvent {
	return {
		summary: `${booking.name} · ${booking.town}`,
		description: booking.basis,
		start: { dateTime: `${booking.start}:00`, timeZone },
		end: { dateTime: `${booking.end}:00`, timeZone },
		extendedProperties: { private: { bookingId: booking.id } },
	};
}
