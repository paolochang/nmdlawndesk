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

	// Codex review of #23 (P2): wrong facts must not reach the retry signal.
	it('reads whole size expressions, never a part of one', () => {
		expect(detailsGiven(['.5 acre at 52 Reed St, Clearwater'])).toMatchObject({ acres: 0.5 });
		expect(detailsGiven(['1 1/2 acres at 52 Reed St, Clearwater'])).toMatchObject({ acres: 1.5 });
		expect(detailsGiven(['0.75 acres at 52 Reed St, Clearwater'])).toMatchObject({ acres: 0.75 });
	});

	it('takes the town from outside the street address', () => {
		expect(detailsGiven(['52 Ashford Rd, Clearwater, half an acre'])).toMatchObject({ town: 'Clearwater', street: '52 Ashford Rd' });
		expect(detailsGiven(['52 Ashford Rd, half an acre'])).toBeUndefined();
	});

	// Holistic review of #23: none of these may send the desk back with wrong facts.
	it('does not read unrelated words as a street, a size, or a town', () => {
		expect(detailsGiven(["Hi, I don't know your prices. How much to mow?", '52 Reed St, Clearwater'])).toBeUndefined();
		expect(detailsGiven(['Not sure if you do hedges too? 52 Reed St, Clearwater'])).toBeUndefined();
		expect(detailsGiven(['Half acre in Ashford. I have 2 dogs by the way'])).toBeUndefined();
		expect(detailsGiven(["Half acre, I'm a 10 minute drive from Dunmore"])).toBeUndefined();
		expect(detailsGiven(['Half acre at 14 Ashford Rd, Fernhill'])).toBeUndefined();
	});

	it('reads "an acre and a half", and never mixes a street with another text\'s town', () => {
		expect(detailsGiven(['An acre and a half at 52 Reed St, Clearwater'])).toMatchObject({ acres: 1.5 });
		expect(detailsGiven(['52 Reed St, Clearwater, half acre', "Actually can you do my mom's place in Dunmore instead?"])).toBeUndefined();
		expect(detailsGiven(['52 Reed St', 'Clearwater, half an acre'])).toMatchObject({ town: 'Clearwater', street: '52 Reed St' });
	});

	it('reads "not sure" as an unknown size only when it is about the size', () => {
		expect(detailsGiven(['Not sure which day yet. 52 Reed St, Clearwater'])).toBeUndefined();
		expect(detailsGiven(["I don't know the size. 52 Reed St, Clearwater"])).toMatchObject({ acres: null });
		expect(detailsGiven(['No idea how big the yard is, 52 Reed St, Clearwater'])).toMatchObject({ acres: null });
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
	const base = { toolCalls: [] as string[], details, offered: false, handedOff: false, retriedAt: -1, texts: 2 };

	it('sends the desk back when it had every detail, offered no times, and called no slot tool', () => {
		expect(shouldRetryForDetails(base)).toBe(true);
		expect(shouldRetryForDetails({ ...base, toolCalls: ['quoteJob'] })).toBe(true);
	});

	it('does not when a detail is missing, times were offered, it did the work, or it already did so for this text', () => {
		expect(shouldRetryForDetails({ ...base, details: undefined })).toBe(false);
		expect(shouldRetryForDetails({ ...base, offered: true })).toBe(false);
		for (const tool of ['findSlots', 'bookSlot', 'handoffToDave']) expect(shouldRetryForDetails({ ...base, toolCalls: [tool] })).toBe(false);
		expect(shouldRetryForDetails({ ...base, retriedAt: 2 })).toBe(false);
		// Holistic review of #23: a customer already handed to Dave, or a yard over 1 acre, is Dave's.
		expect(shouldRetryForDetails({ ...base, handedOff: true })).toBe(false);
		expect(shouldRetryForDetails({ ...base, details: { ...details, acres: 2 } })).toBe(false);
		expect(shouldRetryForDetails({ ...base, details: { ...details, acres: 1 } })).toBe(true);
	});
});
