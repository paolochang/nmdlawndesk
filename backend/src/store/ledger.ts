import { type Preset, pickPreset, presetBookings } from '../domain/presets.ts';
import { RULES, type Town } from '../domain/rules.ts';
import { checkSlot, type SlotCheck } from '../domain/slots.ts';
import type { Booking } from '../domain/types.ts';

/** The synchronous key-value API of a SQLite-backed Durable Object (`ctx.storage.kv`). */
export interface KvStorage {
	get<T>(key: string): T | undefined;
	put(key: string, value: unknown): void;
}

export interface Customer {
	phone: string;
}

export interface VisitorSnapshot {
	generation: number;
	presetId: string;
	customers: Customer[];
	bookings: Booking[];
}

export interface BookingRequest {
	name: string;
	address: string;
	town: Town;
	start: string;
	durationMinutes: number;
	priceCents: number;
	basis: string;
}

export type AddResult =
	| { ok: true; booking: Booking }
	| { ok: false; reason: Extract<SlotCheck, { ok: false }>['reason'] | 'missing-name' };

interface StoredState extends VisitorSnapshot {
	/** Next booking number in this generation. */
	nextBookingNo: number;
}

const KEY = 'state';

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

	/** Books a job if the rules allow it and it overlaps nothing in the calendar. */
	add(request: BookingRequest): AddResult {
		const state = this.#load();
		if (!request.name.trim()) return { ok: false, reason: 'missing-name' };
		const check = checkSlot({
			town: request.town,
			start: request.start,
			durationMinutes: request.durationMinutes,
			from: RULES.demoDate,
			bookings: state.bookings,
		});
		if (!check.ok) return check;
		const booking: Booking = {
			id: `g${state.generation}-${state.nextBookingNo}`,
			...request,
			end: check.slot.end,
		};
		this.#save({ ...state, bookings: [...state.bookings, booking], nextBookingNo: state.nextBookingNo + 1 });
		return { ok: true, booking };
	}

	/** Records a customer phone this visitor created; adding the same phone again changes nothing. */
	addCustomer(phone: string): Customer[] {
		const state = this.#load();
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

	#load(): StoredState {
		const stored = this.#kv.get<StoredState>(KEY);
		if (stored) return stored;
		const first = fresh(1, pickPreset(undefined, this.#random));
		this.#save(first);
		return first;
	}

	#save(state: StoredState): void {
		this.#kv.put(KEY, state);
	}
}

function fresh(generation: number, preset: Preset): StoredState {
	return { generation, presetId: preset.id, customers: [], bookings: presetBookings(preset), nextBookingNo: 1 };
}

function snapshot({ nextBookingNo: _, ...state }: StoredState): VisitorSnapshot {
	return state;
}
