import type { Context, Hono, MiddlewareHandler } from 'hono';
import { hmac, timingSafeEqual } from './crypto.ts';
import { allowEntry, visitorIdFor } from './identity.ts';
import { issueToken, verifyToken } from './token.ts';

/** The Workers KV allowlist, reduced to what sign-in reads. */
export interface Allowlist {
	get(key: string): Promise<string | null>;
}

export interface AuthEnv {
	SECRET?: string;
	ACCESS_CODE?: string;
	ALLOWLIST: Allowlist;
}

export interface AuthDeps {
	env: () => AuthEnv;
	/** Counts one write for this visitor; false once the visitor is over the limit. */
	limit: (visitorId: string) => Promise<boolean>;
	now?: () => number;
}

/**
 * Per-visitor write limit: agent messages and aborts plus calendar resets. Caps
 * LLM cost per reviewer; tune on Day 10 with the production values.
 */
export const WRITE_RATE_LIMIT = { limit: 30, windowMs: 5 * 60 * 1000 };

// Accepts the app with or without a basePath.
type App = Hono<any, any, any>;

/**
 * Mounts `POST /auth` and guards the agent and calendar routes (build-plan §8).
 * Call it before `app.route(...)` for those routes: Hono runs middleware in
 * registration order, so a guard added after a mount never runs.
 */
export function mountAuth(app: App, deps: AuthDeps): void {
	const now = deps.now ?? Date.now;

	app.post('/auth', async (c) => {
		const { SECRET, ACCESS_CODE, ALLOWLIST } = deps.env();
		if (!SECRET || !ACCESS_CODE) return c.json({ error: 'server not configured' }, 500);
		const body = await c.req.json().catch(() => null);
		const accessCode: unknown = body?.accessCode;
		const nickname: unknown = body?.nickname;
		if (typeof accessCode !== 'string' || typeof nickname !== 'string') {
			return c.json({ error: 'accessCode and nickname are required' }, 400);
		}
		// Compare HMACs, not the codes, so both sides have the same length.
		const codeOk = timingSafeEqual(await hmac(SECRET, `code:${accessCode}`), await hmac(SECRET, `code:${ACCESS_CODE}`));
		if (!codeOk || !(await ALLOWLIST.get(await allowEntry(SECRET, nickname)))) {
			return c.json({ error: 'unauthorized' }, 401);
		}
		const visitorId = await visitorIdFor(SECRET, nickname);
		return c.json({ visitorId, ...(await issueToken(SECRET, visitorId, now())) });
	});

	// `agents` with the `s`: a pattern that does not match the mount never guards it.
	app.use('/agents/*', guard(deps, now, (c) => conversationOwner(segmentAfter(c, 'agents', 2))));
	app.use('/calendar/*', guard(deps, now, (c) => segmentAfter(c, 'calendar', 1)));
}

/** 401 without a valid token, 403 for another visitor's path, 429 over the write limit. */
function guard(deps: AuthDeps, now: () => number, ownerOf: (c: Context) => string | undefined): MiddlewareHandler {
	return async (c, next) => {
		const { SECRET } = deps.env();
		if (!SECRET) return c.json({ error: 'server not configured' }, 500);
		const [scheme, token] = (c.req.header('authorization') ?? '').split(' ');
		const visitorId = scheme === 'Bearer' && token ? await verifyToken(SECRET, token, now()) : null;
		if (!visitorId) return c.json({ error: 'unauthorized' }, 401);
		if (ownerOf(c) !== visitorId) return c.json({ error: 'forbidden' }, 403);
		// Only writes (agent messages and aborts, calendar reset) count: they cost LLM calls.
		if (c.req.method === 'POST' && !(await deps.limit(visitorId))) {
			return c.json({ error: 'too many requests' }, 429);
		}
		await next();
	};
}

/** The decoded path segment `offset` places after `name` (e.g. `agents/<agent>/<id>`). */
function segmentAfter(c: Context, name: string, offset: number): string | undefined {
	const segments = c.req.path.split('/');
	const raw = segments[segments.indexOf(name) + offset];
	if (!raw) return undefined;
	try {
		return decodeURIComponent(raw);
	} catch {
		return undefined;
	}
}

/** `<visitorId>:<generation>:<customerPhone|dave>` (build-plan §3) → visitorId. */
function conversationOwner(id: string | undefined): string | undefined {
	const parts = id?.split(':');
	return parts && parts.length >= 3 ? parts[0] : undefined;
}
