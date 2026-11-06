import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allowlistEntries } from '../../scripts/allowlist.ts';
import { allowEntry } from '../../src/auth/identity.ts';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/allowlist.ts');

describe('scripts/allowlist.ts', () => {
	it('turns a nickname list into one KV entry per normalized nickname, never the nickname itself', async () => {
		const entries = await allowlistEntries('s', '# reviewers\nGang\n gang \n\nMina Kim\r\n');
		expect(entries).toEqual([
			{ key: await allowEntry('s', 'gang'), value: '1' },
			{ key: await allowEntry('s', 'mina kim'), value: '1' },
		]);
		expect(JSON.stringify(entries).toLowerCase()).not.toMatch(/gang|mina/);
	});

	it('still runs when started through a symlinked path', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'allowlist-'));
		try {
			const link = join(dir, 'allowlist.ts');
			symlinkSync(SCRIPT, link);
			const out = execFileSync(process.execPath, [link], {
				input: 'Gang\n',
				env: { ...process.env, SECRET: 's' },
				stdio: ['pipe', 'pipe', 'ignore'],
			});
			expect(JSON.parse(out.toString())).toEqual([{ key: await allowEntry('s', 'gang'), value: '1' }]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
