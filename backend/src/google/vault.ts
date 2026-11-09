import { fromBase64url, hmac, toBase64url } from '../auth/crypto.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** AES-GCM key derived from `SECRET`, used only for Google refresh tokens at rest. */
async function tokenKey(secret: string): Promise<CryptoKey> {
	const raw = await hmac(secret, 'google-token-key');
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** `<iv>.<ciphertext>`, both base64url. */
export async function seal(secret: string, plaintext: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(secret), encoder.encode(plaintext));
	return `${toBase64url(iv)}.${toBase64url(new Uint8Array(sealed))}`;
}

/** The plaintext, or null when the value was not sealed under this secret. */
export async function open(secret: string, sealed: string): Promise<string | null> {
	const [ivText, dataText] = sealed.split('.');
	const iv = ivText ? fromBase64url(ivText) : null;
	const data = dataText ? fromBase64url(dataText) : null;
	if (!iv || !data) return null;
	try {
		return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await tokenKey(secret), data));
	} catch {
		return null;
	}
}
