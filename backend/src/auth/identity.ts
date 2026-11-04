import { hmac, toBase64url } from './crypto.ts';

/** Length of a visitorId: 22 base64url characters = 132 bits of the HMAC. */
const VISITOR_ID_LENGTH = 22;

/** NFC, trim, lowercase, collapse inner whitespace (build-plan §8). */
export function normalizeNickname(nickname: string): string {
	return nickname.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** HMAC-SHA256(secret, "allow:" + key), base64url: the Workers KV allowlist key. */
export async function allowEntry(secret: string, nickname: string): Promise<string> {
	return toBase64url(await hmac(secret, `allow:${normalizeNickname(nickname)}`));
}

/**
 * HMAC-SHA256(secret, "visitor:" + key), base64url, truncated: the visitor's
 * environment id. The same nickname always gives the same id, so no nickname is stored.
 */
export async function visitorIdFor(secret: string, nickname: string): Promise<string> {
	return toBase64url(await hmac(secret, `visitor:${normalizeNickname(nickname)}`)).slice(0, VISITOR_ID_LENGTH);
}
