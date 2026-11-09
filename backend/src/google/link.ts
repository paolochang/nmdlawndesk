import { addDays } from '../domain/time.ts';
import type { Booking } from '../domain/types.ts';
import { CalendarApi, CalendarApiError, eventFor } from './calendar-api.ts';
import { exchangeCode, type GoogleClient, GrantRevoked, refreshAccess, revoke } from './oauth.ts';
import { open, seal } from './vault.ts';

/** The calendar the app creates in the reviewer's Google account. */
export const CALENDAR_NAME = "Dave's Lawn Desk";

/** Dates synced: today and the next 13 days, Dave's time zone (build-plan §14). */
export interface SyncWindow {
	from: string;
	to: string;
}

export function syncWindow(today: string): SyncWindow {
	return { from: today, to: addDays(today, 13) };
}

/** What the calendar snapshot says about Google (build-plan §14). */
export interface GoogleStatus {
	connected: boolean;
	window?: SyncWindow;
	syncing?: boolean;
	lastSync?: 'ok' | 'failed';
}

/** The visitor's calendar as the sync sees it. */
export interface CalendarView {
	generation: number;
	today: string;
	timeZone: string;
	bookings: readonly Booking[];
}

interface LinkState {
	/** The refresh token, sealed with a key derived from SECRET (never stored in the clear). */
	sealedToken: string;
	calendarId: string;
	window: SyncWindow;
	/** The generation `events` belongs to: a reset leaves every one of them stale. */
	generation: number;
	/** Booking id → Google event id, for the events this app inserted. */
	events: Record<string, string>;
	lastSync?: 'ok' | 'failed';
	lastAttemptMs?: number;
}

/** The synchronous key-value API of the visitor's Durable Object. */
export interface LinkStorage {
	get<T>(key: string): T | undefined;
	put(key: string, value: unknown): void;
	delete(key: string): unknown;
}

export interface LinkDeps {
	kv: LinkStorage;
	fetch: typeof fetch;
	clock: () => number;
	secret: string;
	client: GoogleClient | undefined;
	calendar: () => CalendarView;
}

const KEY = 'google';
/** After a failed sync, a snapshot read retries no sooner than this. */
const RETRY_AFTER_MS = 60 * 1000;

/** What one sync has to do: events to insert and mapped bookings whose events go. */
export function planSync(view: CalendarView, link: Pick<LinkState, 'window' | 'generation' | 'events'>) {
	const sameGeneration = link.generation === view.generation;
	const mapped = sameGeneration ? link.events : {};
	const inWindow = view.bookings.filter((b) => {
		const day = b.start.slice(0, 10);
		return day >= link.window.from && day <= link.window.to;
	});
	const wanted = new Set(inWindow.map((b) => b.id));
	return {
		insert: inWindow.filter((b) => !(b.id in mapped)),
		remove: Object.keys(link.events).filter((id) => !sameGeneration || !wanted.has(id)),
	};
}

/**
 * One visitor's Google Calendar connection (build-plan §14): the sealed refresh token,
 * the calendar the app created, and which booking became which event. `sync()` makes
 * the calendar match Dave's bookings in the window, touching only events it inserted;
 * syncs never overlap, and a Google failure never reaches the caller.
 */
export class GoogleLink {
	readonly #deps: LinkDeps;
	#access: { token: string; expiresAtMs: number } | undefined;
	#running: Promise<void> | undefined;
	#again = false;

	constructor(deps: LinkDeps) {
		this.#deps = deps;
	}

	get configured(): boolean {
		return Boolean(this.#deps.client);
	}

	status(): GoogleStatus {
		const link = this.#load();
		if (!link) return { connected: false };
		return {
			connected: true,
			window: link.window,
			...(this.#running ? { syncing: true } : {}),
			...(link.lastSync ? { lastSync: link.lastSync } : {}),
		};
	}

	/** Whether a snapshot read should start a sync: work to do, and not right after a failure. */
	wantsSync(): boolean {
		const link = this.#load();
		if (!link || this.#running) return false;
		if (link.lastSync === 'failed' && this.#deps.clock() - (link.lastAttemptMs ?? 0) < RETRY_AFTER_MS) return false;
		const plan = planSync(this.#deps.calendar(), link);
		return plan.insert.length > 0 || plan.remove.length > 0;
	}

	/** Finishes a consent: exchanges the code, creates the calendar, and stores the link. */
	async connect(code: string, redirectUri: string): Promise<void> {
		const client = this.#client();
		const now = this.#deps.clock();
		const grant = await exchangeCode(this.#deps.fetch, client, code, redirectUri, now);
		if (!grant.refreshToken) throw new Error('no refresh token');
		const previous = this.#load();
		if (previous) await this.disconnect();
		const calendarId = await new CalendarApi(this.#deps.fetch, grant.accessToken).createCalendar(CALENDAR_NAME, this.#deps.calendar().timeZone);
		this.#access = { token: grant.accessToken, expiresAtMs: grant.expiresAtMs };
		const view = this.#deps.calendar();
		this.#save({
			sealedToken: await seal(this.#deps.secret, grant.refreshToken),
			calendarId,
			window: syncWindow(view.today),
			generation: view.generation,
			events: {},
		});
	}

	/** Reset all: the window moves to the new today; the next sync drops the old generation's events. */
	moveWindow(today: string): void {
		const link = this.#load();
		if (link) this.#save({ ...link, window: syncWindow(today) });
	}

	/** Runs a sync, or queues one more after the sync already running. Never throws. */
	sync(): Promise<void> {
		if (this.#running) {
			this.#again = true;
			return this.#running;
		}
		this.#running = (async () => {
			do {
				this.#again = false;
				await this.#syncOnce();
			} while (this.#again);
		})().finally(() => {
			this.#running = undefined;
		});
		return this.#running;
	}

	/** Deletes the app's calendar (and every event in it), revokes the grant, and forgets the link. */
	async disconnect(): Promise<{ calendarRemoved: boolean }> {
		await this.#running;
		const link = this.#load();
		if (!link) return { calendarRemoved: true };
		let calendarRemoved = false;
		const refreshToken = await open(this.#deps.secret, link.sealedToken);
		try {
			await this.#withApi(link, (api) => api.deleteCalendar(link.calendarId));
			calendarRemoved = true;
		} catch {
			// The token is forgotten anyway; the reviewer can remove the calendar in Google.
		}
		if (refreshToken) await revoke(this.#deps.fetch, refreshToken);
		this.#forget();
		return { calendarRemoved };
	}

	async #syncOnce(): Promise<void> {
		let link = this.#load();
		if (!link) return;
		const view = this.#deps.calendar();
		const plan = planSync(view, link);
		const byId = new Map(view.bookings.map((b) => [b.id, b]));
		let failed = false;
		try {
			for (const bookingId of plan.remove) {
				const { calendarId, events: mapped } = link;
				await this.#withApi(link, (api) => api.deleteEvent(calendarId, mapped[bookingId]));
				const { [bookingId]: _, ...events } = link.events;
				link = { ...link, events };
				this.#save(link);
			}
			if (link.generation !== view.generation) {
				link = { ...link, generation: view.generation, events: {} };
				this.#save(link);
			}
			for (const booking of plan.insert) {
				if (!byId.has(booking.id)) continue;
				const { calendarId } = link;
				const eventId: string = await this.#withApi(link, (api) => api.insertEvent(calendarId, eventFor(booking, view.timeZone)));
				link = { ...link, events: { ...link.events, [booking.id]: eventId } };
				this.#save(link);
			}
		} catch (error) {
			if (error instanceof GrantRevoked) {
				this.#forget();
				return;
			}
			failed = true;
		}
		const latest = this.#load();
		if (latest) this.#save({ ...latest, lastSync: failed ? 'failed' : 'ok', lastAttemptMs: this.#deps.clock() });
	}

	/** Calls the API with a live access token, refreshing it once on 401. */
	async #withApi<T>(link: LinkState, call: (api: CalendarApi) => Promise<T>): Promise<T> {
		try {
			return await call(new CalendarApi(this.#deps.fetch, await this.#token(link)));
		} catch (error) {
			if (!(error instanceof CalendarApiError) || error.status !== 401) throw error;
			this.#access = undefined;
			return call(new CalendarApi(this.#deps.fetch, await this.#token(link)));
		}
	}

	async #token(link: LinkState): Promise<string> {
		const now = this.#deps.clock();
		if (this.#access && this.#access.expiresAtMs > now) return this.#access.token;
		const refreshToken = await open(this.#deps.secret, link.sealedToken);
		if (!refreshToken) throw new GrantRevoked('token unreadable');
		const grant = await refreshAccess(this.#deps.fetch, this.#client(), refreshToken, now);
		this.#access = { token: grant.accessToken, expiresAtMs: grant.expiresAtMs };
		return grant.accessToken;
	}

	#client(): GoogleClient {
		if (!this.#deps.client) throw new Error('Google client not configured');
		return this.#deps.client;
	}

	#load(): LinkState | undefined {
		return this.#deps.kv.get<LinkState>(KEY) ?? undefined;
	}

	#save(link: LinkState): void {
		this.#deps.kv.put(KEY, link);
	}

	#forget(): void {
		this.#access = undefined;
		this.#deps.kv.delete(KEY);
	}
}
