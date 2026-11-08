// What the customer conversation has come to. `bookingStatus` reads the tool
// results (the system's record: the reveal on Dave's side and the earlier
// customers list, a tester aid); `textedStatus` is what the desk's texts told the
// customer, which is all the customer's Booking status card shows (build-plan §13).
import type { FlueConversationMessage } from '@flue/react';
import { statesDuration, statesPrice, statesStreet, statesTime } from './texted.ts';

export type BookingStatus =
  | { kind: 'open' }
  | {
      kind: 'booked';
      bookingId: string;
      when: string;
      price: string;
      duration: string;
      address: string;
      /** A handoff reason when the booked customer was passed to Dave afterwards. */
      handedOff?: string;
    }
  | { kind: 'with-dave'; reason: string };

type Record_ = Record<string, unknown>;
const isRecord = (value: unknown): value is Record_ => typeof value === 'object' && value !== null;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export function bookingStatus(messages: readonly FlueConversationMessage[]): BookingStatus {
  let booking: Extract<BookingStatus, { kind: 'booked' }> | undefined;
  let handoff: string | undefined;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'dynamic-tool' || part.state !== 'output-available' || !isRecord(part.output)) continue;
      const input = isRecord(part.input) ? part.input : {};
      if (part.toolName === 'bookSlot' && part.output.ok === true) {
        const place = [str(input.address), str(input.town)].filter(Boolean).join(', ');
        booking = {
          kind: 'booked',
          bookingId: str(part.output.bookingId),
          when: str(part.output.when),
          price: str(part.output.price),
          duration: str(part.output.duration),
          address: place,
        };
        handoff = undefined;
      } else if (part.toolName === 'handoffToDave' && part.output.ok === true) {
        handoff = str(input.reason) || 'other';
      }
    }
  }
  if (booking) return handoff ? { ...booking, handedOff: handoff } : booking;
  return handoff ? { kind: 'with-dave', reason: handoff } : { kind: 'open' };
}

/**
 * The status to show now. While the desk is replying, its `bookSlot` or
 * `handoffToDave` result can land before its text; until that text arrives the
 * status stays what it was when the customer sent their last text.
 */
export function settledStatus(messages: readonly FlueConversationMessage[], deskReplying: boolean): BookingStatus {
  if (!deskReplying) return bookingStatus(messages);
  const lastText = messages.findLastIndex((message) => message.role === 'user');
  return bookingStatus(messages.slice(0, lastText + 1));
}

/** The customer's Booking status card: only what the desk's texts stated (build-plan §13). */
export type TextedStatus =
  | { kind: 'open' }
  | {
      kind: 'booked';
      /** The booked day and time, once a desk text stated them (it always has, for `booked`). */
      when: string;
      /** Each detail only if a desk text stated it. */
      where?: string;
      price?: string;
      duration?: string;
      handedOff?: string;
    }
  | { kind: 'with-dave'; reason: string };

/**
 * The status as the customer's texts show it. A booking counts once a desk text
 * after the `bookSlot` result states its day and start time; a handoff once a
 * desk text after `handoffToDave` gives its reply. While the desk is replying,
 * only what was settled before the customer's last text counts.
 */
export function textedStatus(messages: readonly FlueConversationMessage[], deskReplying = false): TextedStatus {
  const settled = deskReplying ? messages.slice(0, messages.findLastIndex((m) => m.role === 'user') + 1) : messages;
  type Pending =
    | { kind: 'booked'; start: string; address: string; town: string; when: string; price: string; duration: string }
    | { kind: 'with-dave'; reason: string; reply: string };
  let pending: Pending | undefined;
  let booked: Extract<TextedStatus, { kind: 'booked' }> | undefined;
  let handoff: string | undefined;
  const confirm = (text: string) => {
    if (!pending) return;
    if (pending.kind === 'booked' && statesTime(text, pending.start)) {
      booked = { kind: 'booked', when: pending.when };
      if (statesStreet(text, pending.address)) booked.where = [pending.address, pending.town].filter(Boolean).join(', ');
      if (statesPrice(text, pending.price)) booked.price = pending.price;
      if (statesDuration(text, pending.duration)) booked.duration = pending.duration;
      handoff = undefined;
      pending = undefined;
    } else if (pending.kind === 'with-dave' && (text.includes(pending.reply) || /contact you directly/i.test(text))) {
      handoff = pending.reason;
      pending = undefined;
    }
  };
  for (const message of settled) {
    for (const part of message.parts) {
      if (part.type === 'text' && message.role === 'assistant') {
        confirm(part.text);
        continue;
      }
      if (part.type !== 'dynamic-tool' || part.state !== 'output-available' || !isRecord(part.output)) continue;
      const input = isRecord(part.input) ? part.input : {};
      if (part.toolName === 'bookSlot' && part.output.ok === true) {
        pending = {
          kind: 'booked',
          start: str(input.start),
          address: str(input.address),
          town: str(input.town),
          when: str(part.output.when),
          price: str(part.output.price),
          duration: str(part.output.duration),
        };
      } else if (part.toolName === 'handoffToDave' && part.output.ok === true) {
        pending = { kind: 'with-dave', reason: str(input.reason) || 'other', reply: str(part.output.reply) };
      }
    }
  }
  if (booked) return handoff ? { ...booked, handedOff: handoff } : booked;
  return handoff ? { kind: 'with-dave', reason: handoff } : { kind: 'open' };
}
