import { describe, expect, it } from 'vitest';
import { allowlistEntries } from '../../scripts/allowlist.ts';
import { allowEntry } from '../../src/auth/identity.ts';

describe('scripts/allowlist.ts', () => {
	it('turns a nickname list into one KV entry per normalized nickname, never the nickname itself', async () => {
		const entries = await allowlistEntries('s', '# reviewers\nGang\n gang \n\nMina Kim\r\n');
		expect(entries).toEqual([
			{ key: await allowEntry('s', 'gang'), value: '1' },
			{ key: await allowEntry('s', 'mina kim'), value: '1' },
		]);
		expect(JSON.stringify(entries).toLowerCase()).not.toMatch(/gang|mina/);
	});
});
