import type { ToolDefinition } from '@flue/runtime';
import { defineTool } from '@flue/runtime/tool';
import * as v from 'valibot';
import type { Conversation } from '../domain/conversation.ts';
import { dollars, quote } from '../domain/quote.ts';
import { RULES, resolveTown, TOWNS, townWeekdays, WEEKDAY_NAMES } from '../domain/rules.ts';
import { findSlots } from '../domain/slots.ts';
import { splitDateTime, weekdayOf } from '../domain/time.ts';
import type { TimeRange } from '../domain/types.ts';
import type { AddResult, BookingRequest, Customer, VisitorSnapshot } from '../store/ledger.ts';

export type CustomerConversation = Extract<Conversation, { kind: 'customer' }>;

/** The visitor's store as the tools reach it (the VisitorStore RPC stub in the Worker). */
export interface DeskStore {
	list(): Promise<VisitorSnapshot>;
	add(request: BookingRequest): Promise<AddResult>;
	addCustomer(phone: string, generation?: number): Promise<Customer[]>;
}

export const HANDOFF_REASONS = ['out-of-area', 'yard-over-1-acre', 'complaint', 'refund', 'haggling', 'other'] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export interface DaveAlert {
	reason: HandoffReason;
	details: string;
	customerPhone: string;
}

export interface DeskDeps {
	conversation: CustomerConversation;
	store: DeskStore;
	/** Posts the alert into this visitor's Dave conversation of the same generation. */
	alertDave(alert: DaveAlert): Promise<void>;
}

/** The customer reply the prompt asks for on every handoff (build-plan §4). */
export const HANDOFF_REPLY = 'Dave will contact you directly.';

const HANDOFF_NEXT = `If this issue is not handed off yet, call handoffToDave now, then reply: "${HANDOFF_REPLY}" Otherwise do not hand it off again; answer the customer's question from the rules.`;
const HANDED_OFF_NEXT =
	"Send the reply once, now. After that keep answering the customer's general questions from the rules; do not call handoffToDave again for this issue.";
const PRICE_NOTE = 'Final price may change on site.';

// Required but nullable: the model must say "unknown" explicitly instead of dropping the key.
const acres = v.pipe(
	v.nullable(v.pipe(v.number(), v.gtValue(0))),
	v.description('Yard size in acres, e.g. 0.5. Always pass it; null only when the customer does not know.'),
);
const town = v.pipe(v.string(), v.description(`The customer's town: ${TOWNS.join(', ')}. Fix obvious misspellings.`));

type Rejection = Extract<AddResult, { ok: false }>['reason'];
const REJECTION_NEXT: Record<Rejection, string> = {
	overlap: 'That time was just taken. Call findSlots again and offer the new times.',
	past: 'Not a bookable time. Offer only times from findSlots.',
	'wrong-weekday': 'Not a bookable time. Offer only times from findSlots.',
	'outside-hours': 'Not a bookable time. Offer only times from findSlots.',
	'off-grid': 'Not a bookable time. Offer only times from findSlots.',
	'missing-name': "Ask the customer's name, then book.",
	handoff: HANDOFF_NEXT,
	'invalid-request': `Check the town (${TOWNS.join(', ')}), the start (a findSlots start), and the yard size.`,
	'stale-generation': 'The demo was reset, so nothing was booked. Tell the customer to text again from a new conversation.',
};

/** `quoteJob`, `findSlots`, `bookSlot`, `handoffToDave` (build-plan §5) over one customer conversation. */
export function deskTools(deps: DeskDeps): ToolDefinition[] {
	return [
		defineTool({
			name: 'quoteJob',
			description: 'Price a mowing job from the yard size. Returns price, duration, and the basis, or a handoff.',
			input: v.object({ acres }),
			run({ data }) {
				const q = quote(data.acres ?? 'unknown');
				if (q.kind === 'handoff') return { output: { handoff: 'yard-over-1-acre', next: HANDOFF_NEXT } };
				return { output: { price: dollars(q.priceCents), duration: hours(q.durationMinutes), basis: q.basis, note: PRICE_NOTE } };
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
					v.description(`First day to search, YYYY-MM-DD. Omit to search from today (${RULES.demoDate}).`),
				),
			}),
			async run({ data }) {
				const resolved = resolveTown(data.town);
				if (!resolved) return { output: { handoff: 'out-of-area', towns: TOWNS, next: HANDOFF_NEXT } };
				const q = quote(data.acres ?? 'unknown');
				if (q.kind === 'handoff') return { output: { handoff: 'yard-over-1-acre', next: HANDOFF_NEXT } };
				const { bookings } = await deps.store.list();
				const slots = findSlots({
					town: resolved,
					durationMinutes: q.durationMinutes,
					from: data.from ?? RULES.demoDate,
					bookings,
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
				name: v.pipe(v.string(), v.description("The customer's name. Ask for it first; never guess.")),
				address: v.pipe(v.string(), v.description('Street address, e.g. 45 Oak Rd.')),
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
				const { booking } = result;
				return {
					output: {
						ok: true,
						bookingId: booking.id,
						when: slotLabel(booking),
						duration: hours(booking.durationMinutes),
						price: dollars(booking.priceCents),
						basis: booking.basis,
						note: PRICE_NOTE,
					},
				};
			},
		}),
		defineTool({
			name: 'handoffToDave',
			description:
				'Hand the customer to Dave: outside the service area, yard over 1 acre, complaint, refund, or haggling (pushing for a lower price or a discount). Asking what a job costs is not haggling. Alerts Dave right away; do not collect more details first. Once per issue.',
			input: v.object({
				reason: v.picklist(HANDOFF_REASONS),
				details: v.pipe(
					v.string(),
					v.description("What Dave needs, from what the customer already said: name, address, town, yard size, request."),
				),
			}),
			async run({ data }) {
				await deps.alertDave({ reason: data.reason, details: data.details, customerPhone: deps.conversation.phone });
				return { output: { ok: true, reply: HANDOFF_REPLY, next: HANDED_OFF_NEXT } };
			},
		}),
	];
}

function hours(minutes: number): string {
	return `${minutes / 60} h`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Thu Nov 19, 8:00-9:30 AM`, `Tue Nov 17, 11:30 AM-12:30 PM`. */
export function slotLabel({ start, end }: TimeRange): string {
	const from = splitDateTime(start);
	const to = splitDateTime(end);
	const [, month, day] = from.date.split('-').map(Number);
	const sameHalf = from.minutes < 720 === to.minutes < 720;
	const times = `${clock(from.minutes, !sameHalf)}-${clock(to.minutes, true)}`;
	return `${WEEKDAY_NAMES[weekdayOf(from.date)]} ${MONTHS[month - 1]} ${day}, ${times}`;
}

function clock(minutes: number, meridiem: boolean): string {
	const h = Math.floor(minutes / 60);
	const text = `${h % 12 || 12}:${String(minutes % 60).padStart(2, '0')}`;
	return meridiem ? `${text} ${h < 12 ? 'AM' : 'PM'}` : text;
}
