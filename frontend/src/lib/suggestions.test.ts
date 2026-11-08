import { describe, expect, it } from 'vitest';
import type { Customer } from './persona.ts';
import { conversationStage, repliesNow, shortSlot, suggestReplies } from './suggestions.ts';
import { done, message, text } from './test-messages.ts';

const maya: Customer = { phone: '+15552841937', name: 'Maya Torres', town: 'Ashford', street: '45 Oak Rd', acres: 0.5 };
const slots = [
  { start: '2026-11-16T08:00', label: 'Mon Nov 16, 8:00-9:00 AM' },
  { start: '2026-11-19T09:30', label: 'Thu Nov 19, 9:30-10:30 AM' },
];
const hi = message('m1', 'user', [text('Hi! How much?')]);
const quoted = message('m2', 'assistant', [done('c1', 'quoteJob', { acres: null }, { price: '$45' }), text('How big is your yard?')]);
const offered = message('m4', 'assistant', [
  done('c2', 'findSlots', { town: 'Ashford', acres: 0.5 }, { town: 'Ashford', slots }),
  text('I can come Mon or Thu. Which works?'),
]);

describe('conversationStage (build-plan §7)', () => {
  it('starts before the customer texts', () => {
    expect(conversationStage([])).toEqual({ kind: 'start' });
  });

  it('asks for details until open times are offered', () => {
    expect(conversationStage([hi])).toEqual({ kind: 'details' });
    expect(conversationStage([hi, quoted])).toEqual({ kind: 'details' });
  });

  it('offers the slots of the last findSlots, and notes a second search', () => {
    expect(conversationStage([hi, quoted, offered])).toEqual({ kind: 'slots', slots, searchedAgain: false });
    const later = message('m6', 'assistant', [done('c3', 'findSlots', { from: '2026-11-22' }, { slots: [slots[1]] })]);
    expect(conversationStage([hi, quoted, offered, later])).toEqual({ kind: 'slots', slots: [slots[1]], searchedAgain: true });
  });

  it('asks for the name when the desk asks for it after offering slots', () => {
    const asked = message('m6', 'assistant', [text('Great. What name should I put the booking under?')]);
    expect(conversationStage([hi, quoted, offered, message('m5', 'user', [text('Monday')]), asked])).toEqual({ kind: 'name' });
  });

  it('keeps the slots when the desk asks for the name in the same text that offers them', () => {
    const both = message('m4', 'assistant', [
      done('c2', 'findSlots', { town: 'Ashford', acres: 0.5 }, { town: 'Ashford', slots }),
      text('I can come Mon or Thu. What is your name so I can book it?'),
    ]);
    expect(conversationStage([hi, both])).toEqual({ kind: 'name', slots });
  });

  it('follows the outcome: booked, or handed to Dave', () => {
    const booked = message('m8', 'assistant', [done('c4', 'bookSlot', {}, { ok: true, when: 'Mon' })]);
    expect(conversationStage([hi, offered, booked])).toEqual({ kind: 'booked' });
    const handoff = message('m8', 'assistant', [done('c4', 'handoffToDave', { reason: 'out-of-area' }, { ok: true })]);
    expect(conversationStage([hi, handoff])).toEqual({ kind: 'handed-off' });
  });
});

describe('suggestReplies', () => {
  it('fills fixed templates from the customer card', () => {
    expect(suggestReplies({ kind: 'start' }, maya)).toEqual([
      'Hi! How much do you charge to mow a lawn?',
      'hw much 2 mow half acre at 45 oak rd ashfrd?',
      'Last time you missed half my yard. I want a refund.',
    ]);
    expect(suggestReplies({ kind: 'details' }, maya)).toEqual([
      'About half an acre, 45 Oak Rd, Ashford',
      'Not sure how big it is. 45 Oak Rd, Ashford',
    ]);
    expect(suggestReplies({ kind: 'details' }, { ...maya, acres: null })).toEqual(["Not sure how big. It's 45 Oak Rd, Ashford"]);
    expect(suggestReplies({ kind: 'name' }, maya)).toEqual(["It's Maya Torres", 'Maya']);
    expect(suggestReplies({ kind: 'name', slots }, maya)).toEqual([
      "It's Maya Torres. Monday Nov 16 at 8 AM works",
      'Maya Torres, Thursday Nov 19 at 9:30 AM please',
    ]);
  });

  it('turns the offered slots into picks, with one ask for later times', () => {
    expect(suggestReplies({ kind: 'slots', slots, searchedAgain: false }, maya)).toEqual([
      'Monday Nov 16 at 8 AM works',
      'Thursday Nov 19 at 9:30 AM, please',
      'Neither works. Anything the week after?',
    ]);
    expect(suggestReplies({ kind: 'slots', slots: [slots[0]], searchedAgain: true }, maya)).toEqual(['Monday Nov 16 at 8 AM works']);
  });

  it('tells apart the same weekday and time in different weeks', () => {
    const weekApart = [
      { start: '2026-11-16T08:00', label: 'Mon Nov 16, 8:00-9:00 AM' },
      { start: '2026-11-23T08:00', label: 'Mon Nov 23, 8:00-9:00 AM' },
    ];
    expect(suggestReplies({ kind: 'slots', slots: weekApart, searchedAgain: true }, maya)).toEqual([
      'Monday Nov 16 at 8 AM works',
      'Monday Nov 23 at 8 AM, please',
    ]);
  });

  it('closes politely or pushes back after the outcome', () => {
    expect(suggestReplies({ kind: 'booked' }, maya)).toEqual(['Thanks, see you then!', 'Can I move it to another day?']);
    expect(suggestReplies({ kind: 'handed-off' }, maya)).toEqual(['OK, thanks!', "Can't you just give me a rough price?"]);
  });
});

describe('repliesNow', () => {
  it('offers no picks until the desk has finished its reply', () => {
    const stage = { kind: 'slots', slots, searchedAgain: false } as const;
    expect(repliesNow(stage, maya, true)).toEqual([]);
    expect(repliesNow(stage, maya, false)).toEqual(suggestReplies(stage, maya));
  });
});

describe('shortSlot', () => {
  it('names the weekday, the date, and the start time', () => {
    expect(shortSlot('2026-11-17T12:00')).toBe('Tuesday Nov 17 at 12 PM');
    expect(shortSlot('2026-11-20T09:30')).toBe('Friday Nov 20 at 9:30 AM');
  });
});
