import { DurableObject } from 'cloudflare:workers';
import { type BookingRequest, VisitorLedger } from './ledger.ts';

/**
 * One Durable Object per visitor (`getByName(visitorId)`), holding that visitor's
 * calendar. Its methods are RPC entry points over the synchronous SQLite KV API,
 * so each call runs to completion before the next one starts.
 */
export class VisitorStore extends DurableObject {
	readonly #ledger = new VisitorLedger(this.ctx.storage.kv);

	list() {
		return this.#ledger.list();
	}

	add(request: BookingRequest) {
		return this.#ledger.add(request);
	}

	addCustomer(phone: string, generation?: number) {
		return this.#ledger.addCustomer(phone, generation);
	}

	reset() {
		return this.#ledger.reset();
	}

	/** One rate-limited write for this visitor (auth middleware, build-plan §8). */
	hit(limit: number, windowMs: number) {
		return this.#ledger.hit(Date.now(), limit, windowMs);
	}
}
