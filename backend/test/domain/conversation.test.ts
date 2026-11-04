import { describe, expect, it } from 'vitest';
import { daveConversationId, parseConversationId } from '../../src/domain/conversation.ts';

describe('parseConversationId', () => {
	it('parses a customer conversation', () => {
		expect(parseConversationId('v123:3:+15550101')).toEqual({
			kind: 'customer',
			visitorId: 'v123',
			generation: 3,
			phone: '+15550101',
		});
	});

	it('parses the Dave conversation', () => {
		expect(parseConversationId('aB_9-x:12:dave')).toEqual({ kind: 'dave', visitorId: 'aB_9-x', generation: 12 });
	});

	it.each([
		['too few parts', 'v123:3'],
		['too many parts', 'v123:3:+15550101:x'],
		['an empty visitor id', ':3:dave'],
		['a visitor id outside the store pattern', 'v.1:3:dave'],
		['generation 0', 'v123:0:dave'],
		['a leading zero', 'v123:03:dave'],
		['a non-numeric generation', 'v123:x:dave'],
		['a phone without +', 'v123:3:15550101'],
		['a phone with letters', 'v123:3:+1555abc'],
		['a too-short phone', 'v123:3:+123'],
		['an upper-case Dave', 'v123:3:DAVE'],
	])('rejects %s', (_case, id) => {
		expect(parseConversationId(id)).toBeUndefined();
	});
});

describe('daveConversationId', () => {
	it('builds the id parseConversationId reads back', () => {
		expect(daveConversationId('v123', 3)).toBe('v123:3:dave');
		expect(parseConversationId(daveConversationId('v123', 3))).toEqual({ kind: 'dave', visitorId: 'v123', generation: 3 });
	});
});
