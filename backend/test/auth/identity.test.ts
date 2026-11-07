import { describe, expect, it } from 'vitest';
import { allowEntry, normalizeNickname, visitorIdFor } from '../../src/auth/identity.ts';
import { issueToken, TOKEN_TTL_SECONDS, verifyToken } from '../../src/auth/token.ts';

const SECRET = 'test-secret';

describe('nickname identity', () => {
	it('normalizes with NFC, trim, lowercase, and collapsed spaces', () => {
		// "가" as a decomposed jamo pair (NFD) must equal the precomposed syllable.
		expect(normalizeNickname('  Kim \t  Gang가 ')).toBe('kim gang가');
	});

	it('is idempotent when lowercasing changes the composition (J + combining caron)', async () => {
		const once = normalizeNickname('J\u030c');
		expect(normalizeNickname(once)).toBe(once);
		expect(await allowEntry(SECRET, once)).toBe(await allowEntry(SECRET, 'J\u030c'));
	});

	it('drops invisible format characters a copied list line can carry (zero-width space, BOM)', () => {
		expect(normalizeNickname('﻿Gang​ Kim‍')).toBe('gang kim');
	});

	it('gives `Gang`, ` gang `, and `GANG` the same visitorId', async () => {
		const ids = await Promise.all(['Gang', ' gang ', 'GANG'].map((n) => visitorIdFor(SECRET, n)));
		expect(new Set(ids).size).toBe(1);
		expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
	});

	it('keeps allowlist entries and visitorIds distinct and secret-bound', async () => {
		const visitor = await visitorIdFor(SECRET, 'gang');
		expect(await allowEntry(SECRET, 'gang')).not.toContain(visitor);
		expect(await visitorIdFor('other-secret', 'gang')).not.toBe(visitor);
		expect(await visitorIdFor(SECRET, 'gong')).not.toBe(visitor);
	});
});

describe('signed token', () => {
	it('round-trips a visitorId until it expires', async () => {
		const now = Date.UTC(2026, 10, 7);
		const { token, expiresAt } = await issueToken(SECRET, 'v_1', now);
		expect(expiresAt).toBe(now / 1000 + TOKEN_TTL_SECONDS);
		expect(await verifyToken(SECRET, token, now + 1000)).toBe('v_1');
		expect(await verifyToken(SECRET, token, expiresAt * 1000)).toBeNull();
	});

	it('rejects a token signed with another secret or with a changed payload', async () => {
		const now = Date.UTC(2026, 10, 7);
		const { token } = await issueToken(SECRET, 'v_1', now);
		expect(await verifyToken('other-secret', token, now)).toBeNull();
		const [, sig] = token.split('.');
		const forged = `${Buffer.from(JSON.stringify({ v: 'v_2', exp: 9e9 })).toString('base64url')}.${sig}`;
		expect(await verifyToken(SECRET, forged, now)).toBeNull();
		expect(await verifyToken(SECRET, 'garbage', now)).toBeNull();
	});
});
