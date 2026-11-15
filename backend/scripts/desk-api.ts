// Shared by scripts/m1.ts and scripts/e2e.ts: sign in, text the desk through the
// API alone, and read what came back (tool calls, the reply, the calendar).
// BASE_URL defaults to http://localhost:8787/api.
import { env } from 'node:process';

export const BASE = env.BASE_URL ?? 'http://localhost:8787/api';

export interface Part {
	type: string;
	text?: string;
	toolName?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
}
export interface Message {
	role: string;
	purpose: string;
	signal?: { tagName?: string; attributes?: Record<string, string> };
	parts: Part[];
}
export interface Snapshot {
	messages: Message[];
	settlements: { submissionId: string; outcome: string; answeredBySubmissionId?: string }[];
}
export interface Booking {
	id: string;
	start: string;
	name: string;
	basis: string;
}
export interface DaveText {
	id: string;
	text: string;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The 429 window is a fixed 5 minutes with no Retry-After, so wait and try again. */
const RATE_LIMIT_WAIT_MS = 30_000;
const RATE_LIMIT_TRIES = 12;

export async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (init.token) headers.authorization = `Bearer ${init.token}`;
	for (let attempt = 1; ; attempt++) {
		const res = await fetch(`${BASE}${path}`, { ...init, headers });
		const body = await res.text();
		if (res.status === 429 && attempt < RATE_LIMIT_TRIES) {
			console.log(`  (429 on ${init.method ?? 'GET'} ${path}; waiting ${RATE_LIMIT_WAIT_MS / 1000} s)`);
			await sleep(RATE_LIMIT_WAIT_MS);
			continue;
		}
		if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${body}`);
		return JSON.parse(body) as T;
	}
}

/** Signs in with an allowlisted nickname. */
export function signIn(accessCode: string, nickname: string) {
	return api<{ visitorId: string; token: string }>('/auth', {
		method: 'POST',
		body: JSON.stringify({ accessCode, nickname }),
	});
}

/** Polls the conversation until the submission settles (2 min cap). */
export async function settled(path: string, token: string, submissionId: string): Promise<Snapshot> {
	for (let i = 0; i < 120; i++) {
		const snap = await api<Snapshot>(path, { token });
		const done = snap.settlements.find(
			(s) => s.submissionId === submissionId || s.answeredBySubmissionId === submissionId,
		);
		if (done) {
			if (done.outcome !== 'completed') throw new Error(`submission ${submissionId} ${done.outcome}`);
			return snap;
		}
		await sleep(1000);
	}
	throw new Error(`submission ${submissionId} did not settle`);
}

/** Sends one customer text and prints the reply and the tool calls of that response. */
export async function text(path: string, token: string, body: string): Promise<Message | undefined> {
	console.log(`\n  customer > ${body}`);
	const { submissionId } = await api<{ submissionId: string }>(path, {
		method: 'POST',
		token,
		body: JSON.stringify({ kind: 'user', body }),
	});
	const snap = await settled(path, token, submissionId);
	const reply = snap.messages.at(-1);
	for (const part of reply?.parts ?? []) {
		if (part.type === 'dynamic-tool') {
			const result = part.state === 'output-error' ? `ERROR ${part.errorText}` : JSON.stringify(part.output);
			console.log(`  [tool] ${part.toolName}(${JSON.stringify(part.input)}) → ${result}`);
		}
	}
	console.log(`  desk     < ${said(reply)}`);
	return reply;
}

export const toolOutputs = (m: Message | undefined, name: string) =>
	(m?.parts ?? []).filter((p) => p.type === 'dynamic-tool' && p.toolName === name && p.state === 'output-available');
export const usedTool = (m: Message | undefined, name: string) => toolOutputs(m, name).length > 0;
export const anyTool = (m: Message | undefined) => (m?.parts ?? []).some((p) => p.type === 'dynamic-tool');
/**
 * What the customer got: the desk's texts and, since #21, a successful handoff's
 * `reply` (the turn ends at the handoff, so that reply is the desk's text).
 */
export const said = (m: Message | undefined) =>
	(m?.parts ?? [])
		.map((p) => {
			if (p.type === 'text') return p.text;
			const output = p.output as { ok?: boolean; reply?: unknown } | undefined;
			if (p.type === 'dynamic-tool' && p.toolName === 'handoffToDave' && p.state === 'output-available' && output?.ok === true && typeof output.reply === 'string') return output.reply;
			return undefined;
		})
		.filter((t): t is string => typeof t === 'string')
		.join(' ');
/**
 * What the desk texted before its last successful `handoffToDave` call that a text follows
 * (issue #19): the customer should get the handoff reply only, so this is empty when the
 * prompt is followed. Mirrors the bubbles (`toBubbles`): think blocks and unfinished texts
 * do not count, and a reply that also booked keeps its confirmation.
 */
export const textBeforeHandoff = (m: Message | undefined): string => {
	const parts = m?.parts ?? [];
	const ok = (p: Part, name: string) => p.type === 'dynamic-tool' && p.toolName === name && p.state === 'output-available' && (p.output as { ok?: boolean } | undefined)?.ok === true;
	if (parts.some((p) => ok(p, 'bookSlot'))) return '';
	const call = parts.findLastIndex((p) => ok(p, 'handoffToDave'));
	if (call < 0 || !parts.some((p, i) => i > call && p.type === 'text')) return '';
	return parts
		.slice(0, call)
		.filter((p) => p.type === 'text' && p.state === 'done')
		.map((p) => (p.text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim())
		.filter(Boolean)
		.join(' ');
};
/** Every handoff reply ends with this (`handoffReply` in src/desk/tools.ts). */
export const HANDOFF_LINE = 'contact you directly';
