import type { ToolDefinition } from '@flue/runtime';
import { defineTool } from '@flue/runtime/tool';
import * as v from 'valibot';
import type { Conversation } from '../domain/conversation.ts';
import { dollars, quote } from '../domain/quote.ts';
import { RULES, resolveTown, TOWNS, townWeekdays, WEEKDAY_NAMES } from '../domain/rules.ts';
import { findSlots } from '../domain/slots.ts';
import { type Clock, localDateTime } from '../domain/time.ts';
import { HANDOFF_REASONS, type HandoffReason } from '../domain/dave-texts.ts';
import { hours, slotLabel } from '../domain/labels.ts';
import type { AddResult, BookingRequest, Customer, VisitorSnapshot } from '../store/ledger.ts';

export type CustomerConversation = Extract<Conversation, { kind: 'customer' }>;

/** The visitor's store as the tools reach it (the VisitorStore RPC stub in the Worker). */
export interface DeskStore {
	list(): Promise<VisitorSnapshot>;
	add(request: BookingRequest): Promise<AddResult>;
	addCustomer(phone: string, generation?: number): Promise<Customer[]>;
	/** Texts Dave the handoff: the reason and the customer's own texts (build-plan §13). */
	handoff(phone: string, reason: HandoffReason, generation: number): Promise<{ ok: boolean }>;
}

export { HANDOFF_REASONS, type HandoffReason };

export interface DeskDeps {
	conversation: CustomerConversation;
	store: DeskStore;
	/** The clock, read in Dave's time zone on every call (build-plan §12). Default `Date.now`. */
	clock?: Clock;
}

/** `Ashford, Clearwater, Birchwood, and Dunmore`. */
const TOWN_LIST = `${TOWNS.slice(0, -1).join(', ')}, and ${TOWNS[TOWNS.length - 1]}`;
const LARGEST = RULES.priceTable[RULES.priceTable.length - 1].maxAcres;

/**
 * The customer's reply on a handoff (build-plan §4): why the desk cannot take it,
 * then that Dave will contact them directly. Fixed text, so the model never
 * invents a reason or a promise.
 */
const HANDOFF_REPLIES: Record<HandoffReason, string> = {
	'out-of-area': `Sorry, Dave doesn't work in your area; he only mows in ${TOWN_LIST}. I've passed your request to Dave, and he will contact you directly to talk it over.`,
	'yard-over-1-acre': `Sorry, I can't book yards over ${LARGEST} acre; Dave prices those himself. I've asked Dave to contact you directly to talk it over.`,
	complaint: "I'm sorry to hear that. I've passed this to Dave, and he will contact you directly.",
	refund: "I'm sorry to hear that. Refunds are handled by Dave himself, so I've passed this to him, and he will contact you directly.",
	haggling: "Sorry, I can't change Dave's prices. I've passed your request to Dave, and he will contact you directly.",
	other: "I can't settle that here, so I've passed it to Dave, and he will contact you directly.",
};

export function handoffReply(reason: HandoffReason): string {
	return HANDOFF_REPLIES[reason];
}

const HANDOFF_NEXT = `If this issue is not handed off yet, call handoffToDave now, then send the reply it returns, word for word. Otherwise do not hand it off again; answer the customer's question from the rules.`;
const HANDED_OFF_NEXT =
	"Send the reply once, now. After that keep answering the customer's general questions from the rules; do not call handoffToDave again for this issue.";
const PRICE_NOTE = 'Final price may change on site.';
const UNKNOWN_SIZE_NOTE = 'Yard size unknown: this is the 1-hour rate, adjusted on site.';

// Required but nullable: the model must say "unknown" explicitly instead of dropping the key.
const acres = v.pipe(
	v.nullable(v.pipe(v.number(), v.gtValue(0))),
	v.description('Yard size in acres, e.g. 0.5. Always pass it; null only when the customer does not know.'),
);
const town = v.pipe(v.string(), v.description(`The customer's town: ${TOWNS.join(', ')}. Fix obvious misspellings.`));

type Rejection = Extract<AddResult, { ok: false }>['reason'];
const REJECTION_NEXT: Record<Rejection, string> = {
	overlap: 'That time was just taken. Call findSlots again and offer the new times.',
	past: 'That time is too soon or already past. Call findSlots again and offer the new times.',
	'wrong-weekday': 'Not a bookable time. Offer only times from findSlots.',
	'outside-hours': 'Not a bookable time. Offer only times from findSlots.',
	'off-grid': 'Not a bookable time. Offer only times from findSlots.',
	'missing-name': "Ask the customer's name, then book.",
	'name-not-texted':
		"The customer has not texted this name. Ask for their name and book with it exactly as they wrote it; never guess or invent one.",
	'address-not-texted':
		'The customer has not texted this street address. Ask for it and book with their words; never guess or invent one.',
	handoff: HANDOFF_NEXT,
	'invalid-request': `Check the town (${TOWNS.join(', ')}), the start (a findSlots start), and the yard size.`,
	'stale-generation': 'The demo was reset, so nothing was booked. Tell the customer to text again from a new conversation.',
};

/** `quoteJob`, `findSlots`, `bookSlot`, `handoffToDave` (build-plan §5) over one customer conversation. */
export function deskTools(deps: DeskDeps): ToolDefinition[] {
	const now = () => localDateTime((deps.clock ?? Date.now)(), RULES.timeZone);
	return [
		defineTool({
			name: 'quoteJob',
			description: 'Price a mowing job from the yard size. Returns the price and duration, or a handoff.',
			input: v.object({ acres }),
			run({ data }) {
				const q = quote(data.acres ?? 'unknown');
				if (q.kind === 'handoff') return { output: { handoff: 'yard-over-1-acre', next: HANDOFF_NEXT } };
				// No calculation basis: the model copied it into texts (build-plan §13); the store keeps it for Dave.
				const note = data.acres === null ? `${UNKNOWN_SIZE_NOTE} ${PRICE_NOTE}` : PRICE_NOTE;
				return { output: { price: dollars(q.priceCents), duration: hours(q.durationMinutes), note } };
			},
		}),
		defineTool({
			name: 'findSlots',
			description:
				"Find Dave's 2 earliest open times for this job on the town's weekdays. Offer only times this returns.",
			input: v.object({
				town,
				acres,
				from: v.pipe(
					v.optional(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))),
					v.description(`First day to search, YYYY-MM-DD. Omit to search from today (${now().slice(0, 10)}).`),
				),
			}),
			async run({ data }) {
				const resolved = resolveTown(data.town);
				if (!resolved) return { output: { handoff: 'out-of-area', towns: TOWNS, next: HANDOFF_NEXT } };
				const q = quote(data.acres ?? 'unknown');
				if (q.kind === 'handoff') return { output: { handoff: 'yard-over-1-acre', next: HANDOFF_NEXT } };
				const { bookings } = await deps.store.list();
				const at = now();
				const slots = findSlots({
					town: resolved,
					durationMinutes: q.durationMinutes,
					from: data.from ?? at.slice(0, 10),
					bookings,
					now: at,
				});
				return {
					output: {
						town: resolved,
						days: townWeekdays(resolved)
							.map((d) => WEEKDAY_NAMES[d])
							.join('/'),
						duration: hours(q.durationMinutes),
						slots: slots.map((s) => ({ start: s.start, label: slotLabel(s) })),
						...(slots.length ? {} : { next: `No open time in the next ${RULES.searchDays} days. ${HANDOFF_NEXT}` }),
					},
				};
			},
		}),
		defineTool({
			name: 'bookSlot',
			description:
				"Book the slot the customer picked. Needs the customer's name, street address, town, the slot start from findSlots, and the yard size. Returns the booking or why it was refused.",
			input: v.object({
				name: v.pipe(v.string(), v.description("The customer's name exactly as they texted it. Ask for it first; never guess.")),
				address: v.pipe(v.string(), v.description('Street address as the customer texted it, e.g. 45 Oak Rd.')),
				town,
				start: v.pipe(v.string(), v.description('The `start` of the chosen findSlots slot, e.g. 2026-11-17T10:00.')),
				acres,
			}),
			async run({ data }) {
				const result = await deps.store.add({
					name: data.name,
					address: data.address,
					town: data.town as BookingRequest['town'],
					start: data.start,
					acres: data.acres ?? 'unknown',
					generation: deps.conversation.generation,
					phone: deps.conversation.phone,
				});
				if (!result.ok) return { output: { ok: false, reason: result.reason, next: REJECTION_NEXT[result.reason] } };
				// The store texted Dave the booking in the same call (build-plan §13).
				const { booking } = result;
				return {
					output: {
						ok: true,
						bookingId: booking.id,
						when: slotLabel(booking),
						duration: hours(booking.durationMinutes),
						price: dollars(booking.priceCents),
						note: PRICE_NOTE,
					},
				};
			},
		}),
		defineTool({
			name: 'handoffToDave',
			description:
				"Hand the customer to Dave: outside the service area, yard over 1 acre, complaint, refund, or haggling (pushing for a lower price or a discount). Asking what a job costs is not haggling. Texts Dave right away with the reason and the customer's own texts; do not collect more details first. Once per issue.",
			input: v.object({ reason: v.picklist(HANDOFF_REASONS) }),
			async run({ data }) {
				const { phone, generation } = deps.conversation;
				const result = await deps.store.handoff(phone, data.reason, generation);
				if (!result.ok) return { output: { ok: false, reason: 'stale-generation', next: REJECTION_NEXT['stale-generation'] } };
				return { output: { ok: true, reply: handoffReply(data.reason), next: HANDED_OFF_NEXT } };
			},
		}),
	];
}
