// What the customer conversation has come to. `bookingStatus` reads the tool
// results (the system's record: the reveal on Dave's side and the earlier
// customers list, a tester aid); `textedStatus` is what the desk's texts told the
// customer, which is all the customer's Booking status card shows (build-plan §13).
import type { FlueConversationMessage } from '@flue/react';
import { statesDuration, statesPrice, statesRange, statesStreet, statesTime, statesTown } from './texted.ts';

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
      /** The day and start time the desk texted, and the end time once a text stated it. */
      when: string;
      /** Each detail only once a desk text stated it. */
      where?: string;
      price?: string;
      duration?: string;
      handedOff?: string;
    }
  | { kind: 'with-dave'; reason: string };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Mon Nov 16, 8:00 AM`, or with the end `Mon Nov 16, 8:00 AM-9:00 AM`: only what was texted. */
function whenLabel(start: string, end?: string): string {
  const [date, time = '00:00'] = start.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const clock = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${MONTHS[month - 1]} ${day}, ${clock(time)}${end ? `-${clock(end.split('T')[1] ?? '00:00')}` : ''}`;
}

interface BookedCall {
  start: string;
  end: string;
  address: string;
  town: string;
  price: string;
  duration: string;
}

/**
 * The status as the customer's texts show it. A booking counts once a desk text
 * after the `bookSlot` result states its day and start time; each detail (end
 * time, street, town, price, length) fills in from that text or any later desk
 * text, until the next booking or handoff. A handoff counts once a desk text gives
 * its reply; the reason shows only when the text is the reason's own reply. While
 * the desk is replying, only what was settled before the customer's last text counts.
 */
export function textedStatus(messages: readonly FlueConversationMessage[], deskReplying = false): TextedStatus {
  const settled = deskReplying ? messages.slice(0, messages.findLastIndex((m) => m.role === 'user') + 1) : messages;
  let pendingBooking: BookedCall | undefined;
  let pendingHandoff: { reason: string; reply: string } | undefined;
  let confirmed: { call: BookedCall; endStated: boolean; streetStated: boolean; townStated: boolean; price?: string; duration?: string } | undefined;
  let handoff: string | undefined;

  const read = (text: string) => {
    if (pendingBooking && statesTime(text, pendingBooking.start)) {
      confirmed = { call: pendingBooking, endStated: false, streetStated: false, townStated: false };
      pendingBooking = undefined;
      handoff = undefined;
    }
    if (confirmed) {
      const { call } = confirmed;
      confirmed.endStated ||= statesRange(text, call.start, call.end);
      confirmed.streetStated ||= statesStreet(text, call.address);
      confirmed.townStated ||= statesTown(text, call.town);
      if (!confirmed.price && statesPrice(text, call.price)) confirmed.price = call.price;
      if (!confirmed.duration && statesDuration(text, call.duration)) confirmed.duration = call.duration;
    }
    if (pendingHandoff && (text.includes(pendingHandoff.reply) || /contact you directly/i.test(text))) {
      // The reason shows only when the text is the reason's own reply; a paraphrase says only "with Dave".
      handoff = pendingHandoff.reply && text.includes(pendingHandoff.reply) ? pendingHandoff.reason : 'other';
      pendingHandoff = undefined;
    }
  };

  for (const message of settled) {
    for (const part of message.parts) {
      if (part.type === 'text' && message.role === 'assistant') {
        read(part.text);
        continue;
      }
      if (part.type !== 'dynamic-tool' || part.state !== 'output-available' || !isRecord(part.output)) continue;
      const input = isRecord(part.input) ? part.input : {};
      if (part.toolName === 'bookSlot' && part.output.ok === true) {
        const start = str(input.start);
        const minutes = Number(str(part.output.duration).replace(/\s*h$/, '')) * 60;
        pendingBooking = {
          start,
          end: endOf(start, minutes),
          address: str(input.address),
          town: str(input.town),
          price: str(part.output.price),
          duration: str(part.output.duration),
        };
      } else if (part.toolName === 'handoffToDave' && part.output.ok === true) {
        pendingHandoff = { reason: str(input.reason) || 'other', reply: str(part.output.reply) };
      }
    }
  }
  if (confirmed) {
    const { call } = confirmed;
    const where = confirmed.streetStated ? [call.address, confirmed.townStated ? call.town : ''].filter(Boolean).join(', ') : undefined;
    const booked: Extract<TextedStatus, { kind: 'booked' }> = {
      kind: 'booked',
      when: whenLabel(call.start, confirmed.endStated ? call.end : undefined),
      ...(where ? { where } : {}),
      ...(confirmed.price ? { price: confirmed.price } : {}),
      ...(confirmed.duration ? { duration: confirmed.duration } : {}),
    };
    return handoff ? { ...booked, handedOff: handoff } : booked;
  }
  return handoff ? { kind: 'with-dave', reason: handoff } : { kind: 'open' };
}

/** Whether the last successful `bookSlot` is still waiting for a desk text to confirm it. */
export function bookingUnconfirmed(messages: readonly FlueConversationMessage[]): boolean {
  let pending: string | undefined;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'text' && message.role === 'assistant' && pending && statesTime(part.text, pending)) pending = undefined;
      if (part.type === 'dynamic-tool' && part.toolName === 'bookSlot' && part.state === 'output-available') {
        if (isRecord(part.output) && part.output.ok === true) pending = str(isRecord(part.input) ? part.input.start : '');
      }
    }
  }
  return pending !== undefined;
}

/** `start` plus `minutes`, same format (`YYYY-MM-DDTHH:mm`, within the day). */
function endOf(start: string, minutes: number): string {
  const [date, time = '00:00'] = start.split('T');
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + (Number.isFinite(minutes) ? minutes : 0);
  return `${date}T${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
