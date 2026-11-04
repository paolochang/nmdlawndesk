// Suggested replies (build-plan §7): fixed templates, never written by a model.
// The stage comes from the customer conversation's tool results and the desk's
// last text; the templates are filled from the customer card and findSlots.
import type { FlueConversationMessage } from '@flue/react';
import type { Customer } from './persona.ts';
import { bookingStatus } from './status.ts';

export interface Slot {
  start: string;
  label: string;
}

export type Stage =
  | { kind: 'start' }
  | { kind: 'details' }
  | { kind: 'slots'; slots: Slot[]; searchedAgain: boolean }
  /** `slots` when the desk asked for the name in the same text that offered them, before any pick. */
  | { kind: 'name'; slots?: Slot[] }
  | { kind: 'booked' }
  | { kind: 'handed-off' };

const isSlot = (value: unknown): value is Slot =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Slot).start === 'string' &&
  typeof (value as Slot).label === 'string';

function slotsOf(output: unknown): Slot[] {
  if (typeof output !== 'object' || output === null) return [];
  const { slots } = output as { slots?: unknown };
  return Array.isArray(slots) ? slots.filter(isSlot) : [];
}

export function conversationStage(messages: readonly FlueConversationMessage[]): Stage {
  const visible = messages.filter((message) => message.display === 'visible');
  if (!visible.some((message) => message.role === 'user')) return { kind: 'start' };

  const status = bookingStatus(messages);
  if (status.kind === 'booked') return { kind: 'booked' };
  if (status.kind === 'with-dave') return { kind: 'handed-off' };

  let offers = 0;
  let slots: Slot[] = [];
  let deskTextAfterOffer = '';
  let customerTextAfterOffer = false;
  for (const message of visible) {
    if (message.role === 'user' && offers > 0) customerTextAfterOffer = true;
    for (const part of message.parts) {
      if (part.type === 'dynamic-tool' && part.toolName === 'findSlots' && part.state === 'output-available') {
        const found = slotsOf(part.output);
        if (found.length) {
          offers++;
          slots = found;
          deskTextAfterOffer = '';
          customerTextAfterOffer = false;
        }
      } else if (part.type === 'text' && message.role === 'assistant' && offers > 0) {
        deskTextAfterOffer = part.text;
      }
    }
  }
  if (!offers) return { kind: 'details' };
  if (/\bname\b/i.test(deskTextAfterOffer)) return customerTextAfterOffer ? { kind: 'name' } : { kind: 'name', slots };
  return { kind: 'slots', slots, searchedAgain: offers > 1 };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `2026-11-16T08:00` → `Monday 8 AM`; `…T09:30` → `… 9:30 AM`. */
export function shortSlot(start: string): string {
  const [date, time = '00:00'] = start.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const clock = `${((hour + 11) % 12) + 1}${minute ? `:${String(minute).padStart(2, '0')}` : ''}`;
  return `${weekday} ${clock} ${hour < 12 ? 'AM' : 'PM'}`;
}

const ACRES_WORDS: Record<string, string> = {
  '0.25': 'a quarter acre',
  '0.5': 'half an acre',
  '0.75': 'three quarters of an acre',
  '1': '1 acre',
};
const ACRES_SHORT: Record<string, string> = { '0.25': '1/4 acre', '0.5': 'half acre', '0.75': '3/4 acre', '1': '1 acre' };

const acresWords = (acres: number) => ACRES_WORDS[String(acres)] ?? `${acres} acres`;
const acresShort = (acres: number) => ACRES_SHORT[String(acres)] ?? `${acres} acres`;
/** A believable typo: lower case, last vowel dropped (`Ashford` → `ashfrd`). */
const typo = (town: string) => town.toLowerCase().replace(/[aeiou](?=[^aeiou]*$)/, '');

export function suggestReplies(stage: Stage, customer: Customer): string[] {
  const { name, town, street, acres } = customer;
  const place = `${street}, ${town}`;
  switch (stage.kind) {
    case 'start':
      return [
        'Hi! How much do you charge to mow a lawn?',
        `hw much 2 mow ${acres === null ? 'my lawn, not sure how big,' : acresShort(acres)} at ${street.toLowerCase()} ${typo(town)}?`,
        'Last time you missed half my yard. I want a refund.',
      ];
    case 'details':
      return acres === null
        ? [`Not sure how big. It's ${place}`]
        : [`About ${acresWords(acres)}, ${place}`, `Not sure how big it is. ${place}`];
    case 'slots': {
      const [first, second] = stage.slots;
      return [
        `${shortSlot(first.start)} works`,
        ...(second ? [`${shortSlot(second.start)}, please`] : []),
        ...(stage.searchedAgain ? [] : ['Neither works. Anything the week after?']),
      ];
    }
    case 'name': {
      if (!stage.slots?.length) return [`It's ${name}`, name.split(' ')[0]];
      const [first, second] = stage.slots;
      return [`It's ${name}. ${shortSlot(first.start)} works`, ...(second ? [`${name}, ${shortSlot(second.start)} please`] : [])];
    }
    case 'booked':
      return ['Thanks, see you then!', 'Can I move it to another day?'];
    case 'handed-off':
      return ['OK, thanks!', "Can't you just give me a rough price?"];
  }
}
