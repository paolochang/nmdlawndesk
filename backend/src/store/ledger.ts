import { bookingBasis, isSeed, type Preset, pickPreset, presetBookings, PRESETS } from '../domain/presets.ts';
import { quote } from '../domain/quote.ts';
import { RULES, resolveTown, type Town } from '../domain/rules.ts';
import { checkSlot, overlaps, type SlotCheck } from '../domain/slots.ts';
import { type Clock, localDateTime, sundayOf } from '../domain/time.ts';
import type { Booking } from '../domain/types.ts';

/** The synchronous key-value API of a SQLite-backed Durable Object (`ctx.storage.kv`). */
export interface KvStorage {
	get<T>(key: string): T | undefined;
	put(key: string, value: unknown): void;
}

export interface Customer {
	phone: string;
	/** Set once the customer gives a name (on booking). */
	name?: string;
}

export interface VisitorSnapshot {
	generation: number;
	presetId: string;
	customers: Customer[];
	bookings: Booking[];
	/** Today in Dave's time zone, `YYYY-MM-DD` (build-plan §12). */
	today: string;
	/** Dave's time zone, an IANA name. */
	timeZone: string;
}

type CalendarState = Omit<VisitorSnapshot, 'today' | 'timeZone'>;

/** What a caller books. The store prices the job itself from `acres` with `quote`. */
export interface BookingRequest {
	name: string;
	address: string;
	town: Town;
	start: string;
	acres: number | 'unknown';
	/** The caller's conversation generation; a booking for an older one is refused. */
	generation?: number;
	/** The customer's phone: a successful booking records `name` for it in the same call. */
	phone?: string;
}

export type AddResult =
	| { ok: true; booking: Booking }
	| {
			ok: false;
			reason:
				| Extract<SlotCheck, { ok: false }>['reason']
				| 'missing-name'
				/** The conversation belongs to a generation before the last reset. */
				| 'stale-generation'
				| 'handoff'
				/** Malformed input: wrong types, unknown town, bad date-time or size. */
				| 'invalid-request';
	  };

interface StoredState extends CalendarState {
	/** Shape of this value; see STATE_VERSION. */
	schemaVersion: number;
	/** The Sunday the latest seeds are dated from (build-plan §12). */
	anchor: string;
	/** Next booking number in this generation. */
	nextBookingNo: number;
}

const KEY = 'state';
/**
 * Bump on any change a stored state of the old shape cannot satisfy. A state with
 * another version (or none, as written before Day 7) is replaced by a reset to the
 * next generation: generations stay monotonic, so an old conversation id never
 * points into the new state.
 */
export const STATE_VERSION = 2;
const RATE_KEY = 'rate';

interface RateWindow {
	windowStart: number;
	count: number;
}

/**
 * One visitor's test environment (build-plan §6): generation, seed preset,
 * customers, and bookings. All state is one value under one key, and every
 * method is synchronous, so inside a Durable Object each call is atomic and two
 * bookings for the same slot cannot both pass the overlap check. "Today" is the
 * clock read in Dave's time zone (§12).
 */
export class VisitorLedger {
	readonly #kv: KvStorage;
	readonly #random: () => number;
	readonly #clock: Clock;

	constructor(kv: KvStorage, random: () => number = Math.random, clock: Clock = Date.now) {
		this.#kv = kv;
		this.#random = random;
		this.#clock = clock;
	}

	list(): VisitorSnapshot {
		const now = this.#now();
		return snapshot(this.#load(now), now);
	}

	/**
	 * Books a job if the rules allow it and it overlaps nothing in the calendar.
	 * Only the request's known fields are read: RPC callers can send anything.
	 */
	add(request: BookingRequest): AddResult {
		const { name, address, start, acres, generation, phone } = request;
		const town = typeof request.town === 'string' ? resolveTown(request.town) : undefined;
		if (typeof name !== 'string' || typeof address !== 'string' || typeof start !== 'string' || !town) {
			return { ok: false, reason: 'invalid-request' };
		}
		if (!name.trim()) return { ok: false, reason: 'missing-name' };
		const now = this.#now();
		const state = this.#load(now);
		if (generation !== undefined && generation !== state.generation) return { ok: false, reason: 'stale-generation' };
		let q: ReturnType<typeof quote>;
		let check: SlotCheck;
		try {
			q = quote(acres);
			if (q.kind === 'handoff') return { ok: false, reason: 'handoff' };
			check = checkSlot({ town, start, durationMinutes: q.durationMinutes, bookings: state.bookings, now });
		} catch (error) {
			if (error instanceof RangeError) return { ok: false, reason: 'invalid-request' };
			throw error;
		}
		if (!check.ok) return check;
		const booking: Booking = {
			id: `g${state.generation}-${state.nextBookingNo}`,
			name,
			address,
			town,
			start,
			end: check.slot.end,
			durationMinutes: q.durationMinutes,
			priceCents: q.priceCents,
			basis: bookingBasis(name, address, town, q.basis),
		};
		const customers = typeof phone === 'string' ? withCustomer(state.customers, phone, name.trim()) : state.customers;
		this.#save({ ...state, customers, bookings: [...state.bookings, booking], nextBookingNo: state.nextBookingNo + 1 });
		return { ok: true, booking };
	}

	/**
	 * Records a customer phone this visitor created; a known phone changes nothing.
	 * A phone from another `generation` (a conversation left behind by a reset) is ignored.
	 */
	addCustomer(phone: string, generation?: number): Customer[] {
		const state = this.#load(this.#now());
		if (generation !== undefined && generation !== state.generation) return state.customers;
		if (state.customers.some((c) => c.phone === phone)) return state.customers;
		const customers = [...state.customers, { phone }];
		this.#save({ ...state, customers });
		return customers;
	}

	/** New generation, no customers, and a different random preset's bookings for this week. */
	reset(): VisitorSnapshot {
		const now = this.#now();
		const current = this.#load(now);
		const next = fresh(current.generation + 1, pickPreset(current.presetId, this.#random), now);
		this.#save(next);
		return snapshot(next, now);
	}

	/**
	 * Counts one rate-limited request in a fixed window of `windowMs` and says
	 * whether it is within `limit`. Kept apart from the calendar, so reset does not clear it.
	 */
	hit(nowMs: number, limit: number, windowMs: number): boolean {
		const windowStart = nowMs - (nowMs % windowMs);
		const stored = this.#kv.get<RateWindow>(RATE_KEY);
		const count = stored?.windowStart === windowStart ? stored.count + 1 : 1;
		this.#kv.put(RATE_KEY, { windowStart, count } satisfies RateWindow);
		return count <= limit;
	}

	/** Dave's wall clock now, `YYYY-MM-DDTHH:mm`. */
	#now(): string {
		return localDateTime(this.#clock(), RULES.timeZone);
	}

	#load(now: string): StoredState {
		const stored = this.#kv.get<StoredState>(KEY);
		if (stored?.schemaVersion === STATE_VERSION) {
			const topped = topUp(stored, now.slice(0, 10));
			if (topped !== stored) this.#save(topped);
			return topped;
		}
		const first = stored
			? fresh(stored.generation + 1, pickPreset(stored.presetId, this.#random), now)
			: fresh(1, pickPreset(undefined, this.#random), now);
		this.#save(first);
		return first;
	}

	#save(state: StoredState): void {
		this.#kv.put(KEY, state);
	}
}

/** `customers` with `phone` named `name`, added if new. */
function withCustomer(customers: Customer[], phone: string, name: string): Customer[] {
	const customer = { phone, name };
	return customers.some((c) => c.phone === phone)
		? customers.map((c) => (c.phone === phone ? customer : c))
		: [...customers, customer];
}

function fresh(generation: number, preset: Preset, now: string): StoredState {
	const anchor = sundayOf(now.slice(0, 10));
	return {
		schemaVersion: STATE_VERSION,
		generation,
		presetId: preset.id,
		anchor,
		customers: [],
		bookings: presetBookings(preset, anchor),
		nextBookingNo: 1,
	};
}

/**
 * A returning visitor (build-plan §12): when no seed is on or after `today`, the
 * preset's seeds for this week's Sunday join the calendar. The generation,
 * customers, and existing bookings stay; a seed that overlaps a booking already
 * there is skipped. Returns `state` itself when nothing changes.
 */
function topUp(state: StoredState, today: string): StoredState {
	if (state.bookings.some((b) => isSeed(b) && b.start.slice(0, 10) >= today)) return state;
	const anchor = sundayOf(today);
	const preset = PRESETS.find((p) => p.id === state.presetId);
	if (!preset || anchor <= state.anchor) return state;
	const seeds = presetBookings(preset, anchor).filter((seed) => !state.bookings.some((b) => overlaps(b, seed)));
	return { ...state, anchor, bookings: [...state.bookings, ...seeds] };
}

function snapshot(
	{ nextBookingNo: _, schemaVersion: __, anchor: ___, ...state }: StoredState,
	now: string,
): VisitorSnapshot {
	return { ...state, today: now.slice(0, 10), timeZone: RULES.timeZone };
}
