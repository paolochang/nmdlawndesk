import { describe, expect, it } from 'vitest';
import { detailsGiven, shouldRetryForDetails } from '../../src/desk/intake.ts';

// #22: the desk asked again for details it had instead of calling quoteJob and findSlots.
describe('detailsGiven', () => {
	it('reads the town, street, and an unknown size from the texts the desk had (owner E2E 2026-11-15)', () => {
		expect(detailsGiven(['Hi! How much do you charge to mow a lawn?', 'Not sure how big it is. 52 Reed St, Clearwater'])).toEqual({
			town: 'Clearwater',
			street: '52 Reed St',
			acres: null,
		});
	});

	it('reads sizes in acres, fractions, words, and square feet, and a misspelled town', () => {
		expect(detailsGiven(['About three quarters of an acre, 45 Oak Rd, Ashford'])).toMatchObject({ town: 'Ashford', acres: 0.75 });
		expect(detailsGiven(['hw much 2 mow half acre at 31 quarry way dunmor?'])).toEqual({ town: 'Dunmore', street: '31 quarry way', acres: 0.5 });
		expect(detailsGiven(['hw much 2 mow 3/4 acre at 120 birch ave birchwod?'])).toMatchObject({ town: 'Birchwood', acres: 0.75 });
		expect(detailsGiven(['About 1 acre, 7 Hollow Ln, Ashford'])).toMatchObject({ acres: 1 });
		expect(detailsGiven(['It is 20,000 sq ft at 7 Hollow Ln, Ashford'])).toMatchObject({ acres: 0.46 });
	});

	it('finds nothing when a detail is missing or the town is not one of Dave\'s', () => {
		expect(detailsGiven(['Half an acre in Ashford'])).toBeUndefined();
		expect(detailsGiven(['About 1 acre, 2 Hill Ct, Fernhill'])).toBeUndefined();
		expect(detailsGiven(['Dave mowed my lawn last week and missed the whole back yard.'])).toBeUndefined();
		expect(detailsGiven(['12 Elm St, Ashford'])).toBeUndefined();
	});
});

describe('shouldRetryForDetails', () => {
	const details = { town: 'Clearwater' as const, street: '52 Reed St', acres: null };
	const base = { toolCalls: [] as string[], details, offered: false, retriedAt: -1, texts: 2 };

	it('sends the desk back when it had every detail, offered no times, and called no slot tool', () => {
		expect(shouldRetryForDetails(base)).toBe(true);
		expect(shouldRetryForDetails({ ...base, toolCalls: ['quoteJob'] })).toBe(true);
	});

	it('does not when a detail is missing, times were offered, it did the work, or it already did so for this text', () => {
		expect(shouldRetryForDetails({ ...base, details: undefined })).toBe(false);
		expect(shouldRetryForDetails({ ...base, offered: true })).toBe(false);
		for (const tool of ['findSlots', 'bookSlot', 'handoffToDave']) expect(shouldRetryForDetails({ ...base, toolCalls: [tool] })).toBe(false);
		expect(shouldRetryForDetails({ ...base, retriedAt: 2 })).toBe(false);
	});
});
