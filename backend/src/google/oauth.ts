import { fromBase64url, hmac, timingSafeEqual, toBase64url } from '../auth/crypto.ts';

/** The only scope the app asks for: the calendars it creates, and their events (build-plan §14). */
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

/** How long a consent round trip may take. */
export const STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleClient {
	clientId: string;
	clientSecret: string;
}

/** The Google consent URL for one visitor's connect. */
export function consentUrl(clientId: string, redirectUri: string, state: string): string {
	return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: GOOGLE_SCOPE,
		access_type: 'offline',
		prompt: 'consent',
		state,
	})}`;
}

/**
 * `<visitorId>.<expiresAt>.<nonce>.<mac>`: the redirect back from Google carries no
 * bearer token, so the callback trusts only this signed value.
 */
export async function signState(secret: string, visitorId: string, nowMs: number): Promise<string> {
	const nonce = toBase64url(crypto.getRandomValues(new Uint8Array(12)));
	const body = `${visitorId}.${nowMs + STATE_TTL_MS}.${nonce}`;
	return `${body}.${toBase64url(await hmac(secret, `google-state:${body}`))}`;
}

/** The signed visitorId and nonce; null when forged, malformed, or expired. */
export async function verifyState(secret: string, state: string, nowMs: number): Promise<{ visitorId: string; nonce: string } | null> {
	const parts = state.split('.');
	if (parts.length !== 4) return null;
	const [visitorId, expiresAt, nonce, mac] = parts;
	const given = fromBase64url(mac);
	if (!given) return null;
	const expected = await hmac(secret, `google-state:${visitorId}.${expiresAt}.${nonce}`);
	if (!timingSafeEqual(given, expected)) return null;
	if (!(Number(expiresAt) > nowMs)) return null;
	return { visitorId, nonce };
}

export interface TokenGrant {
	accessToken: string;
	expiresAtMs: number;
	refreshToken?: string;
}

/** Thrown when Google refuses a grant: the refresh token was revoked or expired. */
export class GrantRevoked extends Error {}

/** Exchanges a consent code for tokens. */
export async function exchangeCode(
	fetcher: typeof fetch,
	client: GoogleClient,
	code: string,
	redirectUri: string,
	nowMs: number,
): Promise<TokenGrant> {
	return tokenRequest(fetcher, nowMs, {
		code,
		client_id: client.clientId,
		client_secret: client.clientSecret,
		redirect_uri: redirectUri,
		grant_type: 'authorization_code',
	});
}

/** A fresh access token from a refresh token. */
export async function refreshAccess(fetcher: typeof fetch, client: GoogleClient, refreshToken: string, nowMs: number): Promise<TokenGrant> {
	return tokenRequest(fetcher, nowMs, {
		refresh_token: refreshToken,
		client_id: client.clientId,
		client_secret: client.clientSecret,
		grant_type: 'refresh_token',
	});
}

/** Revokes the grant; best effort (a token Google no longer knows is already revoked). */
export async function revoke(fetcher: typeof fetch, token: string): Promise<void> {
	await fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token }) }).catch(() => undefined);
}

async function tokenRequest(fetcher: typeof fetch, nowMs: number, params: Record<string, string>): Promise<TokenGrant> {
	const res = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams(params) });
	const body = (await res.json().catch(() => ({}))) as {
		access_token?: string;
		expires_in?: number;
		refresh_token?: string;
		error?: string;
	};
	if (body.error === 'invalid_grant') throw new GrantRevoked('grant revoked or expired');
	if (!res.ok || typeof body.access_token !== 'string') throw new Error(`token request failed: ${res.status}`);
	return {
		accessToken: body.access_token,
		// A minute early, so a token is never used at the edge of its life.
		expiresAtMs: nowMs + ((body.expires_in ?? 3600) - 60) * 1000,
		...(typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : {}),
	};
}
