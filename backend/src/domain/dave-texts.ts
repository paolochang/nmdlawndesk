// The texts Dave's phone gets (build-plan §13): one fixed template per situation,
// filled only from the store's booking (a texted name and address) or the
// customer's own texts. No model writes them.

import { dollars } from './quote.ts';
import { hours, slotLabel } from './labels.ts';
import type { Booking } from './types.ts';

export const HANDOFF_REASONS = ['out-of-area', 'yard-over-1-acre', 'complaint', 'refund', 'haggling', 'other'] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

const REASON_LABELS: Record<HandoffReason, string> = {
	'out-of-area': 'outside your towns',
	'yard-over-1-acre': 'yard over 1 acre',
	complaint: 'a complaint',
	refund: 'a refund request',
	haggling: 'asking for a lower price',
	other: 'a request the desk cannot settle',
};

/** How many of the customer's latest texts a handoff quotes. */
export const QUOTED_TEXTS = 3;

/** `Booked g2-1: Sarah Lee, Tue Nov 17, 10:00-11:00 AM, 45 Oak Rd, Birchwood. $45 (1 h). Phone +15550101.` */
export function bookingText(booking: Booking, phone: string): string {
	const when = slotLabel(booking);
	return `Booked ${booking.id}: ${booking.name}, ${when}, ${booking.address}, ${booking.town}. ${dollars(booking.priceCents)} (${hours(booking.durationMinutes)}). Phone ${phone}.`;
}

/** `Please call +15550102 (yard over 1 acre). They texted: "…" / "…"` */
export function handoffText(reason: HandoffReason, phone: string, texts: readonly string[]): string {
	// One line per quote, double quotes made single, so a quote cannot pose as another text.
	const quote = (text: string) => `"${text.replace(/\s+/g, ' ').trim().replaceAll('"', "'")}"`;
	const quoted = texts.slice(-QUOTED_TEXTS).map(quote).join(' / ');
	return `Please call ${phone} (${REASON_LABELS[reason]}).${quoted ? ` They texted: ${quoted}` : ''}`;
}
