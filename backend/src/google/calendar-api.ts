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

	/**
	 * Inserts an event under its own id. A 409 means an earlier insert of this id already
	 * reached Google (its response was lost), so it counts as inserted.
	 */
	async insertEvent(calendarId: string, event: GoogleEvent): Promise<string> {
		await this.#call('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, event, [409]);
		return event.id;
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
	/** Chosen by the app (base32hex), so a retried insert cannot make a second event. */
	id: string;
	summary: string;
	description: string;
	start: { dateTime: string; timeZone: string };
	end: { dateTime: string; timeZone: string };
	extendedProperties: { private: { bookingId: string } };
}

/** The Google event for one booking: the same title and details as Dave's calendar (build-plan §14). */
export function eventFor(booking: Booking, timeZone: string, id: string): GoogleEvent {
	return {
		id,
		summary: `${booking.name} · ${booking.town}`,
		description: booking.basis,
		start: { dateTime: `${booking.start}:00`, timeZone },
		end: { dateTime: `${booking.end}:00`, timeZone },
		extendedProperties: { private: { bookingId: booking.id } },
	};
}

/**
 * The event id for a booking in a generation: lowercase hex of SHA-256, which Google
 * accepts (base32hex, 5-1024 characters). Booking ids repeat across generations, so the
 * generation is part of it.
 */
export async function eventIdFor(generation: number, bookingId: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${generation}:${bookingId}`));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
