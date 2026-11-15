import { describe, expect, it } from 'vitest';
import { clockTime, jsonLines, jsonTokens, judgmentLogText, reasoningView, SUMMARY_MAX, withPrevious } from './log-format.ts';
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

describe('reasoningView (build-plan §17)', () => {
  it('shows one line: the first sentence of a finished thought, without think tags, clipped with an ellipsis', () => {
    const view = reasoningView('<think>The customer gave 0.5 acre in Ashford.\nSo quote first, then find slots.</think>', true);
    expect(view.summary).toBe('The customer gave 0.5 acre in Ashford.');
    expect(view.full).toBe('The customer gave 0.5 acre in Ashford.\nSo quote first, then find slots.');
    expect(view.more).toBe(true);
    const long = reasoningView(`${'word '.repeat(30)}\n${'more '.repeat(30)}end.`, true).summary;
    expect(long).toHaveLength(SUMMARY_MAX);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toContain('\n');
  });

  it('skips list markers, markdown, abbreviations, and numbers when it finds the first sentence', () => {
    expect(reasoningView('1. Check the town first.\n2. Then quote.', true).summary).toBe('Check the town first.');
    expect(reasoningView('The customer lives at 12 Oak St. in Ashford, so Tuesday. Then quote.', true).summary).toBe(
      'The customer lives at 12 Oak St. in Ashford, so Tuesday.',
    );
    expect(reasoningView('Slot at 10 a.m. Tuesday works for them. Book it.', true).summary).toBe('Slot at 10 a.m. Tuesday works for them.');
    expect(reasoningView('**The customer** has provided:\n- Town: Ashford\n- Yard: half an acre', true).summary).toBe(
      'The customer has provided: Town: Ashford; Yard: half an acre',
    );
  });

  it('has nothing more to show for a short thought, so the row offers no toggle', () => {
    expect(reasoningView('Short thought.', true)).toEqual({ summary: 'Short thought.', full: 'Short thought.', more: false });
  });

  it('shows the newest words of a thought that is still streaming', () => {
    expect(reasoningView('The town is Dunmore.\n\nNext I need the yard size', false).summary).toBe('Next I need the yard size');
    const streaming = reasoningView(`${'x '.repeat(200)}latest words`, false).summary;
    expect(streaming.startsWith('…')).toBe(true);
    expect(streaming.endsWith('latest words')).toBe(true);
    expect(streaming.length).toBeLessThanOrEqual(SUMMARY_MAX);
  });
});

describe('judgmentLogText (owner request)', () => {
  it('copies every entry in order: tools with full input and output or error, reasoning in full', () => {
    const entries: JudgmentEntry[] = [
      { id: 'r', kind: 'reasoning', text: 'The customer wants a quote.\nQuote first.', done: true },
      { id: 'a', kind: 'tool', toolName: 'quoteJob', state: 'output-available', input: { acres: 0.5 }, output: { price: '$45' } },
      { id: 'b', kind: 'tool', toolName: 'bookSlot', state: 'output-error', input: { name: 'Sam' }, errorText: 'boom' },
    ];
    expect(judgmentLogText(entries)).toBe(
      [
        '--:--:-- REASONING\nThe customer wants a quote.\nQuote first.',
        '--:--:-- TOOL quoteJob DONE\ninput: {"acres":0.5}\noutput: {"price":"$45"}',
        '--:--:-- TOOL bookSlot ERROR\ninput: {"name":"Sam"}\nerror: boom',
      ].join('\n\n'),
    );
  });
});
