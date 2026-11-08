// Formatting for the judgment log (build-plan §7): pretty JSON, the lines that
// are new since the previous call of the same tool, colour tokens, and times.
import type { JudgmentEntry } from './transcript.ts';

export interface JsonLine {
  text: string;
  /** New since the previous call of the same tool. */
  added: boolean;
}

const norm = (line: string) => line.trim().replace(/,$/, '');
const isStructural = (line: string) => /^[\s{}[\],]*$/.test(line);

/** Two-space pretty JSON; with `previous`, lines it did not have are marked added. */
export function jsonLines(value: unknown, previous?: unknown): { lines: JsonLine[]; added: number } {
  const text = JSON.stringify(value, null, 2);
  if (text === undefined) return { lines: [], added: 0 };
  const before = previous === undefined ? undefined : new Set((JSON.stringify(previous, null, 2) ?? '').split('\n').map(norm));
  let added = 0;
  const lines = text.split('\n').map((line) => {
    const isNew = before !== undefined && !isStructural(line) && !before.has(norm(line));
    if (isNew) added++;
    return { text: line, added: isNew };
  });
  return { lines, added };
}

export interface JsonToken {
  kind: 'plain' | 'key' | 'string' | 'number' | 'literal';
  text: string;
}

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Splits one line of pretty JSON into coloured tokens. */
export function jsonTokens(line: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const plain = (text: string) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last?.kind === 'plain') last.text += text;
    else tokens.push({ kind: 'plain', text });
  };
  let at = 0;
  for (const match of line.matchAll(TOKEN)) {
    plain(line.slice(at, match.index));
    const [, string, colon, literal, number] = match;
    if (string !== undefined) {
      tokens.push({ kind: colon ? 'key' : 'string', text: string });
      plain(colon ?? '');
    } else if (literal !== undefined) {
      tokens.push({ kind: 'literal', text: literal });
    } else {
      tokens.push({ kind: 'number', text: number });
    }
    at = match.index + match[0].length;
  }
  plain(line.slice(at));
  return tokens;
}

export type LinkedEntry = JudgmentEntry & { previous?: { input: unknown; output?: unknown } };

/** Links each tool call to the previous call of the same tool, for the green new lines. */
export function withPrevious(entries: readonly JudgmentEntry[]): LinkedEntry[] {
  const last = new Map<string, Extract<JudgmentEntry, { kind: 'tool' }>>();
  return entries.map((entry) => {
    if (entry.kind !== 'tool') return entry;
    const before = last.get(entry.toolName);
    last.set(entry.toolName, entry);
    return before ? { ...entry, previous: { input: before.input, output: before.output } } : entry;
  });
}

/** `HH:MM:SS` in local time for a message's ISO timestamp. */
export function clockTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
