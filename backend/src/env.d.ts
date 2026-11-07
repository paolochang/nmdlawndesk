// Bindings this app declares in wrangler.jsonc. Flue's generated FLUE_* agent
// bindings are not listed here: the app never addresses them directly.
declare namespace Cloudflare {
	interface Env {
		AI: Ai;
		VISITOR_STORE: DurableObjectNamespace<import('./store/visitor-store.ts').VisitorStore>;
	}
}
