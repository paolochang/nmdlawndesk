import { bookingText, type HandoffReason, handoffText } from '../domain/dave-texts.ts';
import { addressTexted, nameTexted } from '../domain/grounding.ts';
import { bookingBasis, type Preset, pickPreset, presetBookings, PRESETS } from '../domain/presets.ts';
import { quote } from '../domain/quote.ts';
import { RULES, resolveTown, type Town } from '../domain/rules.ts';
import { checkSlot, overlaps, type SlotCheck } from '../domain/slots.ts';
import { addDays, type Clock, comingSunday, localDateTime } from '../domain/time.ts';
import type { Booking } from '../domain/types.ts';
import type { GoogleStatus } from '../google/link.ts';

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

/** One text the desk sent Dave's phone (build-plan §13), oldest first. */
export interface DaveText {
	id: string;
	text: string;
}

export interface VisitorSnapshot {
	generation: number;
	presetId: string;
	customers: Customer[];
	bookings: Booking[];
	/** What Dave's phone has received in this generation. */
	daveTexts: DaveText[];
	/** Today in Dave's time zone, `YYYY-MM-DD` (build-plan §12). */
	today: string;
	/** Dave's time zone, an IANA name. */
	timeZone: string;
	/** Google Calendar sync, added by the Durable Object (build-plan §14). */
	google?: GoogleStatus;
}

type CalendarState = Omit<VisitorSnapshot, 'today' | 'timeZone' | 'google'>;

/** What a caller books. The store prices the job itself from `acres` with `quote`. */
export interface BookingRequest {
	name: string;
	address: string;
	town: Town;
	start: string;
	acres: number | 'unknown';
	/** The caller's conversation generation; a booking for an older one is refused. */
	generation?: number;
	/**
	 * The customer's phone. With it, the name and street address must appear in that
	 * customer's texts (build-plan §13); a successful booking records the name and
	 * texts Dave in the same call.
	 */
	phone?: string;
}

export type AddResult =
	| { ok: true; booking: Booking }
	| {
			ok: false;
			reason:
				| Extract<SlotCheck, { ok: false }>['reason']
				| 'missing-name'
				/** The customer never texted this name. */
				| 'name-not-texted'
				/** The customer never texted this street address. */
				| 'address-not-texted'
				/** The conversation belongs to a generation before the last reset. */
				| 'stale-generation'
				| 'handoff'
				/** Malformed input: wrong types, unknown town, bad date-time or size. */
				| 'invalid-request';
	  };

interface StoredState extends CalendarState {
	/** Shape of this value; see STATE_VERSION. */
	schemaVersion: number;
	/** The Sunday the latest two weeks of seeds are dated from (build-plan §12). */
	anchor: string;
	/** Next booking number in this generation. */
	nextBookingNo: number;
	/** Each customer's texts in this generation, by phone, oldest first (never in a snapshot). */
	texts?: Record<string, string[]>;
}

/**
 * Texts kept per customer, the longest text kept (in code points), and how many
 * customers' texts a generation keeps, so the one state value stays well under the
 * Durable Object's value limit.
 */
const MAX_TEXTS = 20;
const MAX_TEXT_LENGTH = 300;
const MAX_TEXTING_CUSTOMERS = 30;

const KEY = 'state';
/**
 * Bump on any change a stored state of the old shape cannot satisfy. A state with
 * another version (or none, as written before Day 7) is replaced by a reset to the
 * next generation: generations stay monotonic, so an old conversation id never
 * points into the new state.
 */
export const STATE_VERSION = 3;
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
		if (typeof phone === 'string') {
			const texts = state.texts?.[phone] ?? [];
			if (!nameTexted(texts, name, address)) return { ok: false, reason: 'name-not-texted' };
			if (!addressTexted(texts, address, town)) return { ok: false, reason: 'address-not-texted' };
		}
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
		const daveTexts =
			typeof phone === 'string' ? [...state.daveTexts, { id: booking.id, text: bookingText(booking, phone) }] : state.daveTexts;
		this.#save({
			...state,
			customers,
			daveTexts,
			bookings: [...state.bookings, booking],
			nextBookingNo: state.nextBookingNo + 1,
		});
		return { ok: true, booking };
	}

	/**
	 * Records one text the customer sent (build-plan §13), so a booking can check
	 * the name and address against it. A text from another `generation` is ignored.
	 */
	addCustomerText(phone: string, text: string, generation: number): void {
		const state = this.#load(this.#now());
		if (generation !== state.generation || typeof phone !== 'string' || typeof text !== 'string') return;
		const customers = state.customers.some((c) => c.phone === phone) ? state.customers : [...state.customers, { phone }];
		const kept = [...(state.texts?.[phone] ?? []), Array.from(text).slice(0, MAX_TEXT_LENGTH).join('')].slice(-MAX_TEXTS);
		// The customer who texted longest ago gives way; their bookings stay, new ones need fresh texts.
		const others = Object.entries(state.texts ?? {}).filter(([known]) => known !== phone).slice(-(MAX_TEXTING_CUSTOMERS - 1));
		this.#save({ ...state, customers, texts: { ...Object.fromEntries(others), [phone]: kept } });
	}

	/**
	 * Texts Dave that the desk handed this customer to him: the reason and the
	 * customer's own latest texts. A handoff from another `generation` is refused.
	 */
	handoff(phone: string, reason: HandoffReason, generation: number): { ok: true } | { ok: false; reason: 'stale-generation' } {
		const state = this.#load(this.#now());
		if (generation !== state.generation) return { ok: false, reason: 'stale-generation' };
		const id = `h${state.generation}-${state.daveTexts.length + 1}`;
		const text = handoffText(reason, phone, state.texts?.[phone] ?? []);
		this.#save({ ...state, daveTexts: [...state.daveTexts, { id, text }] });
		return { ok: true };
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

	/** New generation, no customers, and a different random preset's bookings from the coming Sunday. */
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

/**
 * Seeds start on the Monday after the coming Sunday (today on a Sunday), so every
 * seed, and each preset's tight day, is still ahead whatever day the reset is.
 */
function fresh(generation: number, preset: Preset, now: string): StoredState {
	const anchor = comingSunday(now.slice(0, 10));
	return {
		schemaVersion: STATE_VERSION,
		generation,
		presetId: preset.id,
		anchor,
		customers: [],
		bookings: presetBookings(preset, anchor),
		daveTexts: [],
		texts: {},
		nextBookingNo: 1,
	};
}

/**
 * A returning visitor (build-plan §12): once the first week of the current seeds
 * is over, the preset's next two weeks join the calendar, right after the current
 * ones (or from the coming Sunday after a longer absence), so the weeks ahead
 * never run out of seeds and no new seed lands on a past day. The generation,
 * customers, and existing bookings stay; a seed that overlaps a booking already
 * there is skipped. Returns `state` itself when nothing changes.
 */
function topUp(state: StoredState, today: string): StoredState {
	if (today < addDays(state.anchor, 7)) return state;
	const preset = PRESETS.find((p) => p.id === state.presetId);
	if (!preset) return state;
	const next = addDays(state.anchor, 14);
	const coming = comingSunday(today);
	const anchor = coming > next ? coming : next;
	const seeds = presetBookings(preset, anchor).filter((seed) => !state.bookings.some((b) => overlaps(b, seed)));
	return { ...state, anchor, bookings: [...state.bookings, ...seeds] };
}

function snapshot(
	{ nextBookingNo: _, schemaVersion: __, anchor: ___, texts: ____, ...state }: StoredState,
	now: string,
): VisitorSnapshot {
	return { ...state, today: now.slice(0, 10), timeZone: RULES.timeZone };
}
