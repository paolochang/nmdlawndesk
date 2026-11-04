import { bookingBasis, type Preset, pickPreset, presetBookings } from '../domain/presets.ts';
import { quote } from '../domain/quote.ts';
import { resolveTown, type Town } from '../domain/rules.ts';
import { checkSlot, type SlotCheck } from '../domain/slots.ts';
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
}

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

interface StoredState extends VisitorSnapshot {
	/** Shape of this value; see STATE_VERSION. */
	schemaVersion: number;
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
export const STATE_VERSION = 1;
const RATE_KEY = 'rate';

interface RateWindow {
	windowStart: number;
	count: number;
}

/**
 * One visitor's test environment (build-plan §6): generation, seed preset,
 * customers, and bookings. All state is one value under one key, and every
 * method is synchronous, so inside a Durable Object each call is atomic and two
 * bookings for the same slot cannot both pass the overlap check.
 */
export class VisitorLedger {
	readonly #kv: KvStorage;
	readonly #random: () => number;

	constructor(kv: KvStorage, random: () => number = Math.random) {
		this.#kv = kv;
		this.#random = random;
	}

	list(): VisitorSnapshot {
		return snapshot(this.#load());
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
		const state = this.#load();
		if (generation !== undefined && generation !== state.generation) return { ok: false, reason: 'stale-generation' };
		let q: ReturnType<typeof quote>;
		let check: SlotCheck;
		try {
			q = quote(acres);
			if (q.kind === 'handoff') return { ok: false, reason: 'handoff' };
			check = checkSlot({ town, start, durationMinutes: q.durationMinutes, bookings: state.bookings });
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
		const state = this.#load();
		if (generation !== undefined && generation !== state.generation) return state.customers;
		if (state.customers.some((c) => c.phone === phone)) return state.customers;
		const customers = [...state.customers, { phone }];
		this.#save({ ...state, customers });
		return customers;
	}

	/** New generation, no customers, and a different random preset's bookings. */
	reset(): VisitorSnapshot {
		const current = this.#load();
		const next = fresh(current.generation + 1, pickPreset(current.presetId, this.#random));
		this.#save(next);
		return snapshot(next);
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

	#load(): StoredState {
		const stored = this.#kv.get<StoredState>(KEY);
		if (stored?.schemaVersion === STATE_VERSION) return stored;
		const first = stored
			? fresh(stored.generation + 1, pickPreset(stored.presetId, this.#random))
			: fresh(1, pickPreset(undefined, this.#random));
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

function fresh(generation: number, preset: Preset): StoredState {
	return {
		schemaVersion: STATE_VERSION,
		generation,
		presetId: preset.id,
		customers: [],
		bookings: presetBookings(preset),
		nextBookingNo: 1,
	};
}

function snapshot({ nextBookingNo: _, schemaVersion: __, ...state }: StoredState): VisitorSnapshot {
	return state;
}
