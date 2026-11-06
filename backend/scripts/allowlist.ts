// Turns a plain nickname list into Workers KV entries for the sign-in allowlist
// (build-plan §8). The list and the output stay out of the repo (.gitignore).
//
//   SECRET=... node scripts/allowlist.ts nicknames.txt > allowlist.json
//   cat nicknames.txt | SECRET=... node scripts/allowlist.ts > allowlist.json
//
// One nickname per line; blank lines and lines starting with # are skipped.
// SECRET must be the Worker's SECRET, or no entry will match at sign-in.
// Loading the output into KV: put-ai-to-work-challenge/build-plan.md §8 "Allowlist operations".
import { readFileSync, realpathSync } from 'node:fs';
import { argv, env, exit, stderr, stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { allowEntry, normalizeNickname } from '../src/auth/identity.ts';

export interface KvEntry {
	key: string;
	value: string;
}

/** One `{ key: allowEntry, value: "1" }` per distinct normalized nickname, in list order. */
export async function allowlistEntries(secret: string, text: string): Promise<KvEntry[]> {
	const keys = new Set<string>();
	for (const line of text.split(/\r?\n/)) {
		const nickname = normalizeNickname(line);
		if (nickname && !nickname.startsWith('#')) keys.add(await allowEntry(secret, nickname));
	}
	return [...keys].map((key) => ({ key, value: '1' }));
}

async function readStdin(): Promise<string> {
	let text = '';
	for await (const chunk of stdin) text += chunk;
	return text;
}

// Run as a CLI only when this file is the entry point. argv[1] keeps a symlinked
// path while import.meta.url is the real one, so compare real paths.
function realEntry(path: string | undefined): string {
	try {
		return path ? realpathSync(path) : '';
	} catch {
		return '';
	}
}

const entry = realEntry(argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const secret = env.SECRET;
	if (!secret) {
		stderr.write('Set SECRET to the Worker secret (see .dev.vars for local dev).\n');
		exit(1);
	}
	const text = argv[2] ? readFileSync(argv[2], 'utf8') : await readStdin();
	const entries = await allowlistEntries(secret, text);
	stdout.write(`${JSON.stringify(entries, null, '\t')}\n`);
	stderr.write(`${entries.length} allowlist entries\n`);
}
