import { describe, expect, it } from 'vitest';
import { DAVE_PHONE_PROMPT, lawnDeskPrompt } from '../../src/desk/prompts.ts';

// Thu 2026-12-03 10:40 in Dave's time zone.
const NOW = '2026-12-03T10:40';

describe('lawnDeskPrompt', () => {
	it('states the rules from the config (build-plan §4)', () => {
		const prompt = lawnDeskPrompt(NOW);
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

	it("says today and the dates of the next two weeks in Dave's time zone (build-plan §12)", () => {
		const prompt = lawnDeskPrompt(NOW);
		expect(prompt).toContain("Today is Thursday 2026-12-03 in Dave's time zone.");
		expect(prompt).toContain('Fri 2026-12-04, Sat 2026-12-05, Sun 2026-12-06, Mon 2026-12-07, Tue 2026-12-08');
		expect(prompt).toContain('Thu 2026-12-17.');
		expect(prompt).not.toContain('2026-12-18');
	});

	it('asks for texts a person would write: no formulas, arrows, or calculation symbols (build-plan §13)', () => {
		expect(lawnDeskPrompt(NOW)).toContain('never a formula, an arrow, or symbols such as × or →');
	});

	// build-plan §4 "Conversation": not every text is a booking.
	it('answers greetings and general questions from the rules, without intake questions', () => {
		const prompt = lawnDeskPrompt(NOW);
		expect(prompt).toContain('Greetings and general questions (prices, the price table, towns and days, hours)');
		expect(prompt).toContain('answer them directly from the rules above');
		expect(prompt).toMatch(/only once the customer wants a quote or a booking:\s*1\. You need the town, street address, and yard size/);
	});

	it('keeps the handoff rule outside the quote-or-booking gate', () => {
		// A complaint or refund text wants neither a quote nor a booking (PR #8 post-E2E review).
		const prompt = lawnDeskPrompt(NOW);
		const rule = prompt.indexOf('or the customer complains, asks for a refund, or haggles');
		expect(rule).toBeGreaterThan(-1);
		expect(rule).toBeLessThan(prompt.indexOf('How to book, only once'));
		expect(prompt).toContain('When to hand off, on any text:');
	});

	it('offers the price and times before asking the name, and books only a time the customer picked', () => {
		const prompt = lawnDeskPrompt(NOW);
		expect(prompt).toContain("Ask the customer's name only after they pick one of the offered times");
		expect(prompt).toContain('Never call bookSlot before the customer has seen the price and picked a time');
	});

	it('tells a price question apart from haggling', () => {
		expect(lawnDeskPrompt(NOW)).toContain('Asking what a job costs is not haggling');
	});

	it('says the handoff line once, then keeps answering without handing off the same issue again', () => {
		const prompt = lawnDeskPrompt(NOW);
		expect(prompt).toContain('send the reply it returns, word for word');
		expect(prompt).toContain('Send that reply only on the turn you hand off');
		expect(prompt).toContain('keep answering their general questions');
		expect(prompt).toContain('Never call handoffToDave twice for the same issue');
	});
});
