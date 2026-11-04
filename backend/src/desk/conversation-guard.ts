import type { MiddlewareHandler } from 'hono';
import { type Conversation, parseConversationId } from '../domain/conversation.ts';

/**
 * Guards one agent mount (`app.use('<mount>/:id/*', ...)`), after the auth guard:
 * 400 when the id is not a `kind` conversation id (build-plan §3), and 409 when a
 * message is posted to a conversation of another generation than the visitor's
 * current one. A reset leaves old conversations behind; they stay readable and
 * abortable, but never talk to the new calendar.
 */
export function conversationGuard(
	kind: Conversation['kind'],
	currentGeneration: (visitorId: string) => Promise<number>,
): MiddlewareHandler {
	return async (c, next) => {
		const id = c.req.param('id') ?? '';
		const conversation = parseConversationId(id);
		if (conversation?.kind !== kind) return c.json({ error: 'invalid conversation id' }, 400);
		// Only `POST /:id` delivers a message; `POST /:id/abort` and reads pass.
		if (c.req.method === 'POST' && lastSegment(c.req.path) === id) {
			const generation = await currentGeneration(conversation.visitorId);
			if (conversation.generation !== generation) {
				return c.json({ error: 'stale conversation', generation }, 409);
			}
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
