import type { FlueConversationMessage, FlueConversationPart } from '@flue/react';
import { describe, expect, it } from 'vitest';
import { isTyping, replyFailed, toBubbles, toJudgmentLog } from './transcript.ts';

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
