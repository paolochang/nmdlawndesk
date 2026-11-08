// What the customer conversation has come to, read from its tool results
// (build-plan §7 Booking status): booked, handed to Dave, or still open.
import type { FlueConversationMessage } from '@flue/react';

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
