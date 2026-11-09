import { DurableObject } from 'cloudflare:workers';
import type { HandoffReason } from '../domain/dave-texts.ts';
import { GoogleLink } from '../google/link.ts';
import { type BookingRequest, VisitorLedger, type VisitorSnapshot } from './ledger.ts';

/**
 * One Durable Object per visitor (`getByName(visitorId)`), holding that visitor's
 * calendar. Its methods are RPC entry points over the synchronous SQLite KV API,
 * so each call runs to completion before the next one starts. Google Calendar sync
 * (build-plan §14) runs after a call returns, in `waitUntil`, and never changes what
 * the call returns.
 */
export class VisitorStore extends DurableObject<Cloudflare.Env> {
	readonly #ledger = new VisitorLedger(this.ctx.storage.kv);
	readonly #google = new GoogleLink({
		kv: this.ctx.storage.kv,
		fetch: (input, init) => fetch(input, init),
		clock: Date.now,
		secret: this.env.SECRET,
		client:
			this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET
				? { clientId: this.env.GOOGLE_CLIENT_ID, clientSecret: this.env.GOOGLE_CLIENT_SECRET }
				: undefined,
		calendar: () => this.#ledger.list(),
	});

	list(): VisitorSnapshot {
		const snapshot = this.#ledger.list();
		if (this.#google.wantsSync()) this.#sync();
		return { ...snapshot, google: this.#google.status() };
	}

	add(request: BookingRequest) {
		const result = this.#ledger.add(request);
		if (result.ok && this.#google.status().connected) this.#sync();
		return result;
	}

	addCustomer(phone: string, generation?: number) {
		return this.#ledger.addCustomer(phone, generation);
	}

	addCustomerText(phone: string, text: string, generation: number) {
		this.#ledger.addCustomerText(phone, text, generation);
	}

	handoff(phone: string, reason: HandoffReason, generation: number) {
		return this.#ledger.handoff(phone, reason, generation);
	}

	reset(): VisitorSnapshot {
		const snapshot = this.#ledger.reset();
		this.#google.moveWindow(snapshot.today);
		if (this.#google.status().connected) this.#sync();
		return { ...snapshot, google: this.#google.status() };
	}

	/** Finishes a Google consent (the callback route); the first sync follows in the background. */
	async googleConnect(code: string, redirectUri: string): Promise<{ ok: boolean }> {
		try {
			await this.#google.connect(code, redirectUri);
		} catch {
			return { ok: false };
		}
		this.#sync();
		return { ok: true };
	}

	googleDisconnect(): Promise<{ calendarRemoved: boolean }> {
		return this.#google.disconnect();
	}

	/** One rate-limited write for this visitor (auth middleware, build-plan §8). */
	hit(limit: number, windowMs: number) {
		return this.#ledger.hit(Date.now(), limit, windowMs);
	}

	#sync(): void {
		this.ctx.waitUntil(this.#google.sync());
	}
}
