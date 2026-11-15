import type { FlueConversationMessage, FlueConversationPart } from '@flue/react';
import { describe, expect, it } from 'vitest';
import { GREETING, isTyping, phoneText, replyFailed, toBubbles, toJudgmentLog } from './transcript.ts';

function message(
  id: string,
  role: FlueConversationMessage['role'],
  parts: FlueConversationPart[],
  display: FlueConversationMessage['display'] = 'visible',
): FlueConversationMessage {
  const purpose = role === 'system' ? 'dispatch' : role;
  return { id, role, purpose, display, parts };
}

const quote: FlueConversationPart = {
  type: 'dynamic-tool',
  toolName: 'quoteJob',
  toolCallId: 'call-1',
  state: 'output-available',
  input: { acres: 0.5 },
  output: { price: '$45' },
};

const handoff = (output: Record<string, unknown>): FlueConversationPart => ({
  type: 'dynamic-tool',
  toolName: 'handoffToDave',
  toolCallId: 'call-h',
  state: 'output-available',
  input: { reason: 'out-of-area' },
  output,
});
const done = (text: string): FlueConversationPart => ({ type: 'text', text, state: 'done' });
const REPLY = "Sorry, Dave doesn't work in your area. I've passed your request to Dave.";

describe('toBubbles around a handoff (a customer text gets one desk text)', () => {
  it("shows only the handoff reply when the desk wrote a text before calling handoffToDave", () => {
    const bubbles = toBubbles([
      message('m1', 'user', [done('Could you mow 14 Bracken Way, Fernhill?')]),
      message('m2', 'assistant', [done('Your text triggers the out-of-area rule. Handing you to Dave now.'), handoff({ ok: true, reply: REPLY }), done(REPLY)]),
    ]);
    expect(bubbles.map((b) => b.text)).toEqual(['Could you mow 14 Bracken Way, Fernhill?', REPLY]);
  });

  // Holistic review of #20 (P1): a booking and a handoff in one reply must still confirm the booking.
  it('keeps the booking confirmation written before a handoff in the same reply', () => {
    const book: FlueConversationPart = { type: 'dynamic-tool', toolName: 'bookSlot', toolCallId: 'call-b', state: 'output-available', input: {}, output: { ok: true } };
    const confirmation = "You're booked for Mon Nov 16, 8-9 AM at 12 Elm St for $45.";
    const bubbles = toBubbles([message('m1', 'assistant', [book, done(confirmation), handoff({ ok: true, reply: REPLY }), done(REPLY)])]);
    expect(bubbles.map((b) => b.text)).toEqual([confirmation, REPLY]);
  });

  // Holistic review of #20 (P2): while the desk is still replying, the sentence before the call must not flash.
  it('hides the text before a handoff call while the desk is still replying', () => {
    const pending: FlueConversationPart = { ...(handoff({}) as object), state: 'input-available', output: undefined } as FlueConversationPart;
    const earlyText = 'Your text triggers the out-of-area rule.';
    const early = done(earlyText);
    expect(toBubbles([message('m1', 'assistant', [early, pending])], [], true)).toEqual([]);
    expect(toBubbles([message('m1', 'assistant', [early, handoff({ ok: true, reply: REPLY })])], [], true).map((b) => b.text)).toEqual([REPLY]);
    expect(toBubbles([message('m1', 'assistant', [early, handoff({ ok: false, reason: 'not-over-1-acre' })])], [], true).map((b) => b.text)).toEqual([earlyText]);
  });

  // Codex review of #20 (P3): the replying guard is for the message being written, not for history.
  it('shows an earlier handoff the same way when the customer texts again', () => {
    const earlier = message('m1', 'assistant', [done('Dave will be in touch.'), handoff({ ok: true, reply: REPLY })]);
    const again = message('m2', 'user', [done('Any news?')]);
    expect(toBubbles([earlier, again], [], true).map((b) => b.text)).toEqual([REPLY, 'Any news?']);
    expect(toBubbles([earlier, again], [], false).map((b) => b.text)).toEqual([REPLY, 'Any news?']);
  });

  // #21: the turn ends at the handoff, so its reply is the desk's text; a copy the model wrote after it is not shown twice.
  it("shows the handoff's reply as the desk's text, once", () => {
    expect(toBubbles([message('m1', 'assistant', [handoff({ ok: true, reply: REPLY })])]).map((b) => b.text)).toEqual([REPLY]);
    expect(toBubbles([message('m1', 'assistant', [handoff({ ok: true, reply: REPLY }), done(REPLY)])]).map((b) => b.text)).toEqual([REPLY]);
  });

  // Holistic review (P2-1): bookSlot and handoffToDave in one batch keep the turn going, and the model may put
  // the confirmation and a copy of the reply in one text; only the copy goes.
  it('keeps the booking confirmation written in the same text as a copy of the reply', () => {
    const book: FlueConversationPart = { type: 'dynamic-tool', toolName: 'bookSlot', toolCallId: 'call-b', state: 'output-available', input: {}, output: { ok: true } };
    const confirmation = "You're booked for Mon Nov 16, 8-9 AM at 12 Elm St for $45.";
    const bubbles = toBubbles([message('m1', 'assistant', [book, handoff({ ok: true, reply: REPLY }), done(`${confirmation} ${REPLY}`)])]);
    expect(bubbles.map((b) => b.text)).toEqual([REPLY, confirmation]);
  });

  it('keeps the texts around a refused handoff', () => {
    const refused = toBubbles([message('m1', 'assistant', [done('One moment.'), handoff({ ok: false, reason: 'not-over-1-acre' }), done('It is $45.')])]);
    expect(refused.map((b) => b.text)).toEqual(['One moment.', 'It is $45.']);
  });
});

describe('toBubbles', () => {
  it('shows a bubble only for text parts that are done', () => {
    const messages = [
      message('m1', 'user', [{ type: 'text', text: 'Hi, half an acre in Ashford', state: 'done' }]),
      message('m2', 'assistant', [
        { type: 'reasoning', text: 'quote first', state: 'done' },
        quote,
        { type: 'text', text: 'That is $45.', state: 'done' },
        { type: 'text', text: 'Open ti', state: 'streaming' },
      ]),
    ];

    expect(toBubbles(messages)).toEqual([
      { id: 'm1:0', from: 'customer', text: 'Hi, half an acre in Ashford' },
      { id: 'm2:2', from: 'desk', text: 'That is $45.' },
    ]);
  });

  it('never shows thinking the model leaked into a desk text (build-plan §16)', () => {
    const messages = [
      message('m1', 'assistant', [{ type: 'text', text: '<think>Quote first.</think>That is $45.', state: 'done' }]),
      message('m2', 'assistant', [{ type: 'text', text: 'They want Tuesday.\n</think>\n\nTuesday works.', state: 'done' }]),
      message('m3', 'assistant', [{ type: 'text', text: '<think>Only thoughts', state: 'done' }]),
    ];

    expect(toBubbles(messages)).toEqual([
      { id: 'm1:0', from: 'desk', text: 'That is $45.' },
      { id: 'm2:0', from: 'desk', text: 'Tuesday works.' },
    ]);
  });

  it('marks the text of a send that failed as not delivered', () => {
    const messages = [message('local-1', 'user', [{ type: 'text', text: 'Hi', state: 'done' }])];
    expect(toBubbles(messages, ['local-1'])).toEqual([
      { id: 'local-1:0', from: 'customer', text: 'Hi', failed: true },
    ]);
  });

  it('skips system, hidden, and blank messages', () => {
    const messages = [
      message('s1', 'system', [{ type: 'text', text: '<handoff>', state: 'done' }]),
      message('h1', 'assistant', [{ type: 'text', text: 'plumbing', state: 'done' }], 'hidden'),
      message('a1', 'assistant', [{ type: 'text', text: '  ', state: 'done' }]),
    ];

    expect(toBubbles(messages)).toEqual([]);
  });
});

describe('isTyping', () => {
  it('is typing while the prompt is submitted or the reply streams', () => {
    expect(isTyping('submitted')).toBe(true);
    expect(isTyping('streaming')).toBe(true);
    expect(isTyping('idle')).toBe(false);
    expect(isTyping('connecting')).toBe(false);
    expect(isTyping('error')).toBe(false);
  });
});

describe('replyFailed', () => {
  it('is true only for an error that is not one of our failed sends', () => {
    expect(replyFailed('error', 0)).toBe(true);
    expect(replyFailed('error', 1)).toBe(false);
    expect(replyFailed('idle', 0)).toBe(false);
    expect(replyFailed('streaming', 0)).toBe(false);
  });
});

describe('toJudgmentLog', () => {
  it('stamps each entry with the time of its message when the server sent one', () => {
    const stamped = { ...message('m2', 'assistant', [quote]), timestamp: '2026-11-16T09:41:02.000Z' };
    expect(toJudgmentLog([stamped])[0]).toMatchObject({ toolName: 'quoteJob', time: '2026-11-16T09:41:02.000Z' });
  });

  it('lists tool calls with input and output or error, and reasoning, in order', () => {
    const messages = [
      message('m1', 'user', [{ type: 'text', text: 'Hi', state: 'done' }]),
      message('m2', 'assistant', [
        { type: 'reasoning', text: 'Need a quote.', state: 'done' },
        quote,
        {
          type: 'dynamic-tool',
          toolName: 'findSlots',
          toolCallId: 'call-2',
          state: 'input-available',
          input: { town: 'Ashford', acres: 0.5 },
        },
        {
          type: 'dynamic-tool',
          toolName: 'bookSlot',
          toolCallId: 'call-3',
          state: 'output-error',
          input: { name: '' },
          errorText: 'name required',
        },
        { type: 'reasoning', text: 'thinking', state: 'streaming' },
        { type: 'text', text: 'That is $45.', state: 'done' },
      ]),
    ];

    expect(toJudgmentLog(messages)).toEqual([
      { id: 'm2:0', kind: 'reasoning', text: 'Need a quote.', done: true },
      {
        id: 'call-1',
        kind: 'tool',
        toolName: 'quoteJob',
        state: 'output-available',
        input: { acres: 0.5 },
        output: { price: '$45' },
      },
      {
        id: 'call-2',
        kind: 'tool',
        toolName: 'findSlots',
        state: 'input-available',
        input: { town: 'Ashford', acres: 0.5 },
      },
      {
        id: 'call-3',
        kind: 'tool',
        toolName: 'bookSlot',
        state: 'output-error',
        input: { name: '' },
        errorText: 'name required',
      },
      { id: 'm2:4', kind: 'reasoning', text: 'thinking', done: false },
    ]);
  });

  it('is empty before any tool call or reasoning', () => {
    expect(toJudgmentLog([message('m1', 'user', [{ type: 'text', text: 'Hi', state: 'done' }])])).toEqual([]);
  });
});

describe('phoneText (owner request)', () => {
  it("copies the whole thread, one line per bubble with its sender's label", () => {
    const thread = [
      { id: '1', from: 'customer' as const, text: 'Hi! How much?' },
      { id: '2', from: 'desk' as const, text: 'It is $45.' },
    ];
    expect(phoneText(thread, { customer: 'Customer', desk: 'Desk' })).toBe('Customer: Hi! How much?\nDesk: It is $45.');
  });
});

// Owner E2E (2026-11-15): with no first-text note the model still wrote "Thanks for reaching out…" again.
// The greeting is the app's: the first desk text opens with it, and greetings the model writes are dropped.
describe('the greeting', () => {
  const hi = message('m1', 'user', [done('Hi! How much do you charge to mow a lawn?')]);
  const details = message('m3', 'user', [done('About three quarters of an acre, 45 Oak Rd, Ashford')]);
  const greeted = (value: string) => `Thanks for reaching out to Dave's Lawn Desk! I'm Dave's booking assistant. ${value}`;

  it('opens the first desk text with the greeting and drops the ones the model wrote', () => {
    const messages = [
      hi,
      message('m2', 'assistant', [done(greeted("It's $45 for up to half an acre."))]),
      details,
      message('m4', 'assistant', [done(greeted("That's $67.50 for about 1.5 hours."))]),
    ];
    const desk = toBubbles(messages, [], false, GREETING).filter((b) => b.from === 'desk');
    expect(desk.map((b) => b.text)).toEqual([`${GREETING} It's $45 for up to half an acre.`, "That's $67.50 for about 1.5 hours."]);
  });

  it('greets once when the model wrote no greeting, and leaves a plain thanks alone', () => {
    const messages = [hi, message('m2', 'assistant', [done("It's $45.")]), details, message('m4', 'assistant', [done("Thanks! What's your name?")])];
    const desk = toBubbles(messages, [], false, GREETING).filter((b) => b.from === 'desk');
    expect(desk.map((b) => b.text)).toEqual([`${GREETING} It's $45.`, "Thanks! What's your name?"]);
  });
});

// #22: when the desk asked again for details it had, the agent sent it back to the tools with a
// `data-details-retry` marker; the question written before the marker is not sent.
describe('a details retry', () => {
  const marker = { type: 'data-details-retry', data: { at: 2 } } as unknown as FlueConversationPart;
  const asked = done("That would be $45. What's the rough yard size at 52 Reed St?");
  const quoted = done("That's $45 for about an hour, and the final price may change on site. Dave can come Mon Nov 16, 8-9 AM or Thu Nov 19, 9-10 AM; which works?");

  it('sends the reply that followed the retry, not the question before it', () => {
    expect(toBubbles([message('m1', 'assistant', [asked, marker, quoted])]).map((b) => b.text)).toEqual([quoted.type === 'text' ? quoted.text : '']);
  });

  // Holistic review of #23 (P3-6): only the text the retry replaces goes, not an answer written before it.
  it('drops only the last text before the retry', () => {
    const answer = done('We take cash or card on the day.');
    const bubbles = toBubbles([message('m1', 'assistant', [answer, asked, marker, quoted])]).map((b) => b.text);
    expect(bubbles).toEqual(['We take cash or card on the day.', quoted.type === 'text' ? quoted.text : '']);
  });

  it('keeps the question while nothing has followed the retry yet, unless the desk is still replying', () => {
    expect(toBubbles([message('m1', 'assistant', [asked, marker])]).map((b) => b.text)).toHaveLength(1);
    expect(toBubbles([message('m1', 'assistant', [asked, marker])], [], true)).toEqual([]);
  });
});
