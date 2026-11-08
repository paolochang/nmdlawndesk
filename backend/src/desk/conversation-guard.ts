import type { MiddlewareHandler } from 'hono';
import { type Conversation, parseConversationId } from '../domain/conversation.ts';

/**
 * Guards one agent mount (`app.use('<mount>/:id/*', ...)`), after the auth guard:
 * 400 when the id is not a `kind` conversation id (build-plan §3), 400 when a
 * posted message is not `kind: 'user'` (signals, such as handoff alerts, come
 * only from the server's dispatch()), and 409 when a message is posted to a
 * conversation of another generation than the visitor's current one. A reset
 * leaves old conversations behind; they stay readable and abortable, but never
 * talk to the new calendar. `admitted` gets each text that passes, before the
 * agent runs (the lawn desk records the customer's texts, build-plan §13).
 */
export function conversationGuard(
	kind: Conversation['kind'],
	currentGeneration: (visitorId: string) => Promise<number>,
	admitted?: (conversation: Conversation, text: string) => Promise<void>,
): MiddlewareHandler {
	return async (c, next) => {
		const id = c.req.param('id') ?? '';
		const conversation = parseConversationId(id);
		if (conversation?.kind !== kind) return c.json({ error: 'invalid conversation id' }, 400);
		// Only `POST /:id` delivers a message; `POST /:id/abort` and reads pass.
		if (c.req.method === 'POST' && lastSegment(c.req.path) === id) {
			// Read a clone, so the agent router still gets the untouched body. Malformed
			// JSON passes through for the router to reject in its own error envelope.
			const message: unknown = await c.req.raw.clone().json().catch(() => undefined);
			if (typeof message === 'object' && message !== null && (message as { kind?: unknown }).kind !== 'user') {
				return c.json({ error: 'only user messages can be posted' }, 400);
			}
			const generation = await currentGeneration(conversation.visitorId);
			if (conversation.generation !== generation) {
				return c.json({ error: 'stale conversation', generation }, 409);
			}
			const text = (message as { body?: unknown } | undefined)?.body;
			if (admitted && typeof text === 'string') await admitted(conversation, text);
		}
		await next();
	};
}

function lastSegment(path: string): string | undefined {
	const raw = path.split('/').filter(Boolean).at(-1) ?? '';
	try {
		return decodeURIComponent(raw);
	} catch {
		return undefined;
	}
}
