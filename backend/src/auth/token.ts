import { fromBase64url, hmac, timingSafeEqual, toBase64url } from './crypto.ts';

/** How long a sign-in lasts; the reviewer signs in again (nickname prefilled) after this. */
export const TOKEN_TTL_SECONDS = 2 * 60 * 60;

const VISITOR_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface Payload {
	/** visitorId */
	v: string;
	/** Expiry, Unix seconds. */
	exp: number;
}

// The "token:" prefix keeps token signatures apart from the allow:/visitor: HMACs under the same SECRET.
const sign = (secret: string, payload: string) => hmac(secret, `token:${payload}`);

/** `<base64url(JSON payload)>.<base64url(HMAC)>`, valid for TOKEN_TTL_SECONDS. */
export async function issueToken(secret: string, visitorId: string, nowMs: number): Promise<{ token: string; expiresAt: number }> {
	const expiresAt = Math.floor(nowMs / 1000) + TOKEN_TTL_SECONDS;
	const payload = toBase64url(new TextEncoder().encode(JSON.stringify({ v: visitorId, exp: expiresAt } satisfies Payload)));
	return { token: `${payload}.${toBase64url(await sign(secret, payload))}`, expiresAt };
}

/** The token's visitorId, or null when it is malformed, forged, or expired. */
export async function verifyToken(secret: string, token: string, nowMs: number): Promise<string | null> {
	const parts = token.split('.');
	if (parts.length !== 2) return null;
	const [payload, signature] = parts;
	const given = fromBase64url(signature);
	if (!given || !timingSafeEqual(given, await sign(secret, payload))) return null;
	const bytes = fromBase64url(payload);
	if (!bytes) return null;
	let parsed: Partial<Payload>;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
	if (typeof parsed?.v !== 'string' || !VISITOR_ID.test(parsed.v) || typeof parsed.exp !== 'number') return null;
	return nowMs < parsed.exp * 1000 ? parsed.v : null;
}
