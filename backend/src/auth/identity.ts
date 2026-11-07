import { hmac, toBase64url } from './crypto.ts';

/** Length of a visitorId: 22 base64url characters = 132 bits of the HMAC. */
const VISITOR_ID_LENGTH = 22;

/**
 * Drop invisible format characters, NFC, trim, collapse inner whitespace, lowercase
 * (build-plan §8). Format characters (`\p{Cf}`: zero-width space and joiners, BOM)
 * ride along when a list line is copied from a web page. NFC runs again after
 * lowercasing, which can leave a decomposable pair (`J\u030c` → `j\u030c`), so the
 * result is stable when normalized again (the allowlist script does).
 */
export function normalizeNickname(nickname: string): string {
	return nickname
		.replace(/\p{Cf}/gu, '')
		.normalize('NFC')
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase()
		.normalize('NFC');
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
