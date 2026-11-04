import { describe, expect, it } from 'vitest';
import { daveAlertMessage, lawnDeskPrompt } from '../../src/desk/prompts.ts';

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
