// The booking reveal (build-plan §7). Everything that reacts to the desk's
// tool results waits for the desk's text to reach the customer phone: the reveal
// starts when the reply settles (`isTyping` true → false), never from the tool
// result itself. The judgment log is the only live view.
import type { BookingStatus } from './status.ts';
import type { Bubble } from './transcript.ts';

export interface Reveal {
  /** A booking the reply confirmed; the calendar shows it landing. */
  bookingId?: string;
  /** The reply handed the customer to Dave; Dave's phone gets the alert. */
  handoff: boolean;
}

/** Pause between the reply landing and the panels opening to Both. */
export const REVEAL_PAUSE_MS = 900;
/** The panels' width transition (`.stage` in index.css); the booking lands after it. */
export const PANELS_OPEN_MS = 700;
/** How long the new booking keeps its landing animation. */
export const LANDING_MS = 2600;

function handoffOf(status: BookingStatus): string | undefined {
  if (status.kind === 'with-dave') return status.reason;
  if (status.kind === 'booked') return status.handedOff;
  return undefined;
}

/**
 * What a settled reply revealed, comparing the status before the customer's text
 * (`before`) with the status once the desk's reply arrived (`after`). Undefined
 * when nothing new happened.
 */
export function revealOnSettle(before: BookingStatus, after: BookingStatus): Reveal | undefined {
  const bookingId =
    after.kind === 'booked' && (before.kind !== 'booked' || before.bookingId !== after.bookingId)
      ? after.bookingId
      : undefined;
  const handoff = handoffOf(after) !== undefined && handoffOf(before) === undefined;
  return bookingId || handoff ? { bookingId, handoff } : undefined;
}

/**
 * Dave's phone while the customer's desk is still replying: only the bubbles it
 * had when the customer texted (`held`), so a handoff alert never shows before the
 * desk's reply. `held` is undefined once the reply has arrived.
 */
export function gatedBubbles(bubbles: readonly Bubble[], held: number | undefined): readonly Bubble[] {
  return held === undefined ? bubbles : bubbles.slice(0, held);
}

/**
 * The badge on Dave's phone button: texts shown since the phone was last opened.
 * `seen` is undefined until the conversation's history has loaded, so a reload
 * does not count old texts as new.
 */
export function unreadCount(shown: number, seen: number | undefined): number {
  return seen === undefined ? 0 : Math.max(0, shown - seen);
}
