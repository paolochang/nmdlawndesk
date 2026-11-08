// Conversation ids (build-plan §3), chosen by the caller and used in the agent URL:
//   customer: `<visitorId>:<generation>:<customerPhone>`  e.g. `v123:3:+15550101`
//   Dave:     `<visitorId>:<generation>:dave`

export type Conversation =
	| { kind: 'customer'; visitorId: string; generation: number; phone: string }
	| { kind: 'dave'; visitorId: string; generation: number };

/** A truncated base64url HMAC (build-plan §8); it also names the visitor's Durable Object. */
export const VISITOR_ID = /^[A-Za-z0-9_-]{1,64}$/;
const GENERATION = /^[1-9][0-9]{0,8}$/;
/** E.164: `+`, then 7-15 digits, no leading zero. */
const PHONE = /^\+[1-9][0-9]{6,14}$/;

/** The conversation an id names, or undefined for anything malformed. */
export function parseConversationId(id: string): Conversation | undefined {
	const parts = id.split(':');
	if (parts.length !== 3) return undefined;
	const [visitorId, gen, who] = parts;
	if (!VISITOR_ID.test(visitorId) || !GENERATION.test(gen)) return undefined;
	const generation = Number(gen);
	if (who === 'dave') return { kind: 'dave', visitorId, generation };
	if (PHONE.test(who)) return { kind: 'customer', visitorId, generation, phone: who };
	return undefined;
}

/** The Dave conversation of the same visitor and generation. */
export function daveConversationId(visitorId: string, generation: number): string {
	return `${visitorId}:${generation}:dave`;
}
