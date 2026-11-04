import { describe, expect, it } from 'vitest';
import { quote } from '../../src/domain/quote.ts';

describe('quote', () => {
	it.each([
		[0.25, 60, 4500],
		[0.5, 60, 4500],
		[0.75, 90, 6750],
		[1, 90, 6750],
	])('%s acre → %s min, %s cents', (acres, durationMinutes, priceCents) => {
		expect(quote(acres)).toMatchObject({ kind: 'quote', durationMinutes, priceCents });
	});

	it('writes the calculation basis', () => {
		expect(quote(0.5)).toMatchObject({ basis: '0.5 acre → 1 h × $45 = $45' });
		expect(quote(1)).toMatchObject({ basis: '1 acre → 1.5 h × $45 = $67.50' });
	});

	it('hands off anything over 1 acre', () => {
		expect(quote(1.01)).toEqual({ kind: 'handoff', reason: 'yard over 1 acre' });
	});

	it('quotes the 1-hour rate for an unknown size, adjusted on site', () => {
		const result = quote('unknown');
		expect(result).toMatchObject({ kind: 'quote', durationMinutes: 60, priceCents: 4500 });
		expect(result.kind === 'quote' && result.basis).toContain('adjusted on site');
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s acres', (acres) => {
		expect(() => quote(acres)).toThrow(RangeError);
	});
});
