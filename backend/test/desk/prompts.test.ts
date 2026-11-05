import { describe, expect, it } from 'vitest';
import { daveAlertMessage, lawnDeskPrompt } from '../../src/desk/prompts.ts';
import { HANDOFF_REPLY } from '../../src/desk/tools.ts';

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
			'Dave will contact you directly.',
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

	it('tells a price question apart from haggling', () => {
		expect(lawnDeskPrompt()).toContain('Asking what a job costs is not haggling');
	});

	it('says the handoff line once, then keeps answering without handing off the same issue again', () => {
		const prompt = lawnDeskPrompt();
		expect(prompt).toContain(`Say "${HANDOFF_REPLY}" only on the turn you hand off`);
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
