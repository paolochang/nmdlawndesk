import { describe, expect, it } from 'vitest';
import { DAVE_PHONE_PROMPT, daveAlertMessage, daveBookingMessage, lawnDeskPrompt } from '../../src/desk/prompts.ts';

describe('lawnDeskPrompt', () => {
	it('states the rules from the config (build-plan §4)', () => {
		const prompt = lawnDeskPrompt();
		for (const fact of [
			'8 AM-1 PM',
			'Ashford and Clearwater: Mon and Thu',
			'Birchwood and Dunmore: Tue and Fri',
			'$45/hour',
			'1.5 h, $67.50',
			'may change on site',
		]) {
			expect(prompt).toContain(fact);
		}
	});

	// build-plan §4 "Conversation": not every text is a booking.
	it('answers greetings and general questions from the rules, without intake questions', () => {
		const prompt = lawnDeskPrompt();
		expect(prompt).toContain('Greetings and general questions (prices, the price table, towns and days, hours)');
		expect(prompt).toContain('answer them directly from the rules above');
		expect(prompt).toMatch(/only once the customer wants a quote or a booking:\s*1\. You need the town, street address, and yard size/);
	});

	it('keeps the handoff rule outside the quote-or-booking gate', () => {
		// A complaint or refund text wants neither a quote nor a booking (PR #8 post-E2E review).
		const prompt = lawnDeskPrompt();
		const rule = prompt.indexOf('or the customer complains, asks for a refund, or haggles');
		expect(rule).toBeGreaterThan(-1);
		expect(rule).toBeLessThan(prompt.indexOf('How to book, only once'));
		expect(prompt).toContain('When to hand off, on any text:');
	});

	it('offers the price and times before asking the name, and books only a time the customer picked', () => {
		const prompt = lawnDeskPrompt();
		expect(prompt).toContain("Ask the customer's name only after they pick one of the offered times");
		expect(prompt).toContain('Never call bookSlot before the customer has seen the price and picked a time');
	});

	it('tells a price question apart from haggling', () => {
		expect(lawnDeskPrompt()).toContain('Asking what a job costs is not haggling');
	});

	it('says the handoff line once, then keeps answering without handing off the same issue again', () => {
		const prompt = lawnDeskPrompt();
		expect(prompt).toContain('send the reply it returns, word for word');
		expect(prompt).toContain('Send that reply only on the turn you hand off');
		expect(prompt).toContain('keep answering their general questions');
		expect(prompt).toContain('Never call handoffToDave twice for the same issue');
	});
});

describe('daveAlertMessage', () => {
	it('is a handoff signal carrying the reason, customer phone, and details', () => {
		expect(
			daveAlertMessage({ reason: 'out-of-area', details: 'Ann, 9 Hill Rd, Riverside', customerPhone: '+15550102' }),
		).toEqual({
			kind: 'signal',
			type: 'lawn-desk.handoff',
			tagName: 'handoff',
			body: 'Ann, 9 Hill Rd, Riverside',
			attributes: { reason: 'out-of-area', customerPhone: '+15550102' },
		});
	});
});

describe('daveBookingMessage', () => {
	it("is a booking signal Dave's phone turns into one text: who, when, where, price", () => {
		expect(
			daveBookingMessage({
				customerPhone: '+15550101',
				bookingId: 'g1-1',
				name: 'Sarah Lee',
				when: 'Tue Nov 17, 10:00-11:00 AM',
				place: '45 Oak Rd, Birchwood',
				price: '$45',
				duration: '1 h',
			}),
		).toEqual({
			kind: 'signal',
			type: 'lawn-desk.booking',
			tagName: 'booking',
			body: 'Sarah Lee · Tue Nov 17, 10:00-11:00 AM · 45 Oak Rd, Birchwood · $45 (1 h)',
			attributes: { bookingId: 'g1-1', customerPhone: '+15550101' },
		});
		expect(DAVE_PHONE_PROMPT).toMatch(/<booking>/);
	});
});
