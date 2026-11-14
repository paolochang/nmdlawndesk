// Formatting for the judgment log (build-plan §7): pretty JSON, the lines that
// are new since the previous call of the same tool, colour tokens, times, and the
// one-line summary of a reasoning row (build-plan §17).
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

/** The longest reasoning summary, in characters (build-plan §17). */
export const SUMMARY_MAX = 120;

/** What a reasoning row shows: one line, the whole thought, and whether there is more than the line. */
export interface ReasoningView {
  summary: string;
  full: string;
  more: boolean;
}

/** Words a period can follow without ending the sentence ("12 Oak St. in Ashford", "10 a.m. Tuesday"). */
const NO_SENTENCE_END = new Set(['st', 'rd', 'ave', 'dr', 'ln', 'ct', 'blvd', 'mr', 'mrs', 'ms', 'a.m', 'p.m', 'e.g', 'i.e', 'etc', 'vs', 'approx', 'no']);
/** A first "sentence" shorter than this is a label ("Plan:", "1."), so the summary runs on. */
const MIN_SENTENCE = 20;

/** One line of the thought without list markers, headings, or markdown emphasis. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:#+\s*|(?:\d+[.)]|[-*•])\s+)/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first sentence end that is not an abbreviation, a number, or a too-short label. */
function firstSentence(flat: string): string {
  for (const match of flat.matchAll(/[.!?](?=\s|$)/g)) {
    const end = match.index + 1;
    const word = /(\S+)$/.exec(flat.slice(0, match.index))?.[1].toLowerCase() ?? '';
    if (NO_SENTENCE_END.has(word.replace(/\.$/, '')) || /^\d+$|^[a-z]$/.test(word) || end < MIN_SENTENCE) continue;
    return flat.slice(0, end);
  }
  return flat;
}

const clipEnd = (line: string) => (line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : line);
const clipStart = (line: string) => (line.length > SUMMARY_MAX ? `…${line.slice(line.length - SUMMARY_MAX + 1).trimStart()}` : line);

/**
 * A reasoning row (build-plan §17). Think tags are dropped once, for both the line and
 * the whole thought. A finished thought shows its first sentence; one still streaming
 * shows its latest line, ending at the newest words. Either is clipped to
 * `SUMMARY_MAX` characters, and `more` says the whole thought has more to show.
 */
export function reasoningView(text: string, done: boolean): ReasoningView {
  const full = text.replace(/<\/?think>/gi, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const lines = full.split('\n').map(plainLine).filter(Boolean);
  if (lines.length === 0) return { summary: '', full, more: false };
  const last = lines.length - 1;
  const flat = lines.map((line, i) => (i < last && !/[.!?:;,]$/.test(line) ? `${line};` : line)).join(' ');
  const summary = done ? clipEnd(firstSentence(flat)) : clipStart(lines[last]);
  return { summary, full, more: summary !== flat };
}
