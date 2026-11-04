import { describe, expect, it } from 'vitest';
import { clockTime, jsonLines, jsonTokens, withPrevious } from './log-format.ts';
import type { JudgmentEntry } from './transcript.ts';

describe('jsonLines (build-plan §7 judgment log)', () => {
  it('pretty-prints a value', () => {
    expect(jsonLines({ acres: 0.5 }).lines).toEqual([
      { text: '{', added: false },
      { text: '  "acres": 0.5', added: false },
      { text: '}', added: false },
    ]);
  });

  it('marks only the lines that are new since the previous call', () => {
    const { lines, added } = jsonLines({ price: '$45', basis: '0.5 acre' }, { price: '$45', basis: 'size unknown' });
    expect(lines.filter((line) => line.added).map((line) => line.text)).toEqual(['  "basis": "0.5 acre"']);
    expect(added).toBe(1);
  });

  it('has nothing to show for a missing value', () => {
    expect(jsonLines(undefined).lines).toEqual([]);
  });
});

describe('jsonTokens', () => {
  it('splits a line into keys, strings, numbers, and literals for colour', () => {
    expect(jsonTokens('  "ok": true,')).toEqual([
      { kind: 'plain', text: '  ' },
      { kind: 'key', text: '"ok"' },
      { kind: 'plain', text: ': ' },
      { kind: 'literal', text: 'true' },
      { kind: 'plain', text: ',' },
    ]);
    expect(jsonTokens('  "label": "Mon 8:00", "n": -1.5')).toEqual([
      { kind: 'plain', text: '  ' },
      { kind: 'key', text: '"label"' },
      { kind: 'plain', text: ': ' },
      { kind: 'string', text: '"Mon 8:00"' },
      { kind: 'plain', text: ', ' },
      { kind: 'key', text: '"n"' },
      { kind: 'plain', text: ': ' },
      { kind: 'number', text: '-1.5' },
    ]);
  });
});

describe('withPrevious', () => {
  it('links each tool call to the previous call of the same tool', () => {
    const entries: JudgmentEntry[] = [
      { id: 'a', kind: 'tool', toolName: 'quoteJob', state: 'output-available', input: { acres: null }, output: { price: '$45' } },
      { id: 'r', kind: 'reasoning', text: 'size known now', done: true },
      { id: 'b', kind: 'tool', toolName: 'findSlots', state: 'output-available', input: {}, output: {} },
      { id: 'c', kind: 'tool', toolName: 'quoteJob', state: 'input-available', input: { acres: 0.5 } },
    ];
    const linked = withPrevious(entries);
    expect(linked[0]).not.toHaveProperty('previous');
    expect(linked[2]).not.toHaveProperty('previous');
    expect(linked[3]).toMatchObject({ previous: { input: { acres: null }, output: { price: '$45' } } });
  });
});

describe('clockTime', () => {
  it('shows the local wall-clock time of a message', () => {
    expect(clockTime(new Date(2026, 10, 16, 9, 41, 2).toISOString())).toBe('09:41:02');
    expect(clockTime(undefined)).toBeUndefined();
    expect(clockTime('not a date')).toBeUndefined();
  });
});
