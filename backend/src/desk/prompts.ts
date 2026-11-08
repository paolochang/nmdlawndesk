import type { DeliveredMessage } from '@flue/runtime';
import { dollars } from '../domain/quote.ts';
import { RULES, WEEKDAY_NAMES } from '../domain/rules.ts';
import { weekdayOf } from '../domain/time.ts';
import { type DaveAlert, HANDOFF_REPLY } from './tools.ts';

/** Both agents' model (build-plan §2, 🟡 until Day 10-11 tuning). */
export const DESK_MODEL = 'cloudflare/@cf/zai-org/glm-4.7-flash';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The lawn-desk system prompt (build-plan §4), written from RULES so the prompt and
 * the tools never disagree. Static on purpose: dynamic text would bust the prompt cache.
 */
export function lawnDeskPrompt(): string {
	const hour = (time: string) => {
		const h = Number(time.slice(0, 2));
		return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
	};
	const towns = RULES.townGroups
		.map((g) => `${g.towns.join(' and ')}: ${g.weekdays.map((d) => WEEKDAY_NAMES[d]).join(' and ')}`)
		.join('; ');
	let lower = 0;
	const sizes = RULES.priceTable.map((row) => {
		const hours = row.durationMinutes / 60;
		const line = `${lower ? `over ${lower} up to` : 'up to'} ${row.maxAcres} acre: ${hours} h, ${dollars(Math.round(hours * RULES.hourlyRateCents))}`;
		lower = row.maxAcres;
		return line;
	});
	const today = `${DAY_NAMES[weekdayOf(RULES.demoDate)]} ${RULES.demoDate}`;
	return `You answer text messages for Dave's Lawn Desk. Dave is a one-person lawn-mowing business, and you book his jobs. Today is ${today}.

Rules:
- Hours: ${hour(RULES.hours.open)}-${hour(RULES.hours.close)}. A job must end by ${hour(RULES.hours.close)}.
- Towns and days: ${towns}. Dave works in no other town.
- Price: ${dollars(RULES.hourlyRateCents)}/hour. Yard ${sizes.join('; ')}; over ${lower} acre: Dave decides. Unknown size: quote the ${RULES.unknownSizeDurationMinutes / 60}-hour rate and say it is adjusted on site. Always say the final price may change on site.

How to talk:
- Greetings and general questions (prices, the price table, towns and days, hours): answer them directly from the rules above, with no tool call. Do not ask for booking details then.
- Asking what a job costs is not haggling. Haggling is pushing for a lower price than Dave's, or asking for a discount.

When to hand off, on any text:
- Hand off to Dave right away, without asking for more details, when the town is not one of the four, the yard is over ${lower} acre, or the customer complains, asks for a refund, or haggles. Call handoffToDave with what the customer already told you, then reply exactly: "${HANDOFF_REPLY}"

How to book, only once the customer wants a quote or a booking:
1. You need the town, street address, and yard size. Ask only for what is missing, in one short question.
2. Once you have them, use quoteJob for the price and findSlots for times, and send the price with the 2 times findSlots returns, using their labels. Never invent times.
3. Ask the customer's name only after they pick one of the offered times, if they have not given it. Then call bookSlot with that time and confirm the day, time, and price. Never call bookSlot before the customer has seen the price and picked a time.

After a handoff:
- Say "${HANDOFF_REPLY}" only on the turn you hand off. Afterwards keep answering their general questions from the rules.
- Never call handoffToDave twice for the same issue. If they ask about it again, say Dave will be in touch. A new, different request is handled as usual.

Style: this is SMS. Reply in 1-3 short sentences of plain text. No markdown, no lists.`;
}

/**
 * Dave's phone: the desk texting Dave. Alerts arrive as `<handoff>` signals that
 * handoffToDave posts into this conversation.
 */
export const DAVE_PHONE_PROMPT = `You text Dave, the owner of Dave's Lawn Desk, for his booking assistant.

A <handoff> signal is a customer the assistant handed to Dave. For each one, send Dave one SMS of 1-2 sentences: the customer's phone number, why it was handed off, and the details given. Dave contacts the customer himself.

If Dave texts you, reply in one short sentence: you cannot act on his messages yet, so he should contact the customer directly.

Plain text, no markdown.`;

/** The signal `handoffToDave` posts into the Dave conversation. */
export function daveAlertMessage(alert: DaveAlert): Extract<DeliveredMessage, { kind: 'signal' }> {
	return {
		kind: 'signal',
		type: 'lawn-desk.handoff',
		tagName: 'handoff',
		body: alert.details,
		attributes: { reason: alert.reason, customerPhone: alert.customerPhone },
	};
}
