// Bindings this app declares in wrangler.jsonc. Flue's generated FLUE_* agent
// bindings are not listed here: the app never addresses them directly.
declare namespace Cloudflare {
	interface Env {
		AI: Ai;
		VISITOR_STORE: DurableObjectNamespace<import('./store/visitor-store.ts').VisitorStore>;
		/** Sign-in allowlist: `allowEntry` values as keys (scripts/allowlist.ts). */
		ALLOWLIST: KVNamespace;
		/** Secret: HMAC key for allowEntry, visitorId, and tokens. Never rotate during the demo. */
		SECRET: string;
		/** Secret: the shared access code reviewers type at sign-in. */
		ACCESS_CODE: string;
	}
}
