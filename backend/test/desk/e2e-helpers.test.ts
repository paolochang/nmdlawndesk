import { describe, expect, it } from 'vitest';
import { type Message, said, textBeforeHandoff } from '../../scripts/desk-api.ts';

const text = (value: string) => ({ type: 'text', text: value, state: 'done' });
const tool = (toolName: string, output: unknown) => ({ type: 'dynamic-tool', toolName, state: 'output-available', output });
const reply = (parts: object[]) => ({ role: 'assistant', purpose: 'assistant', parts }) as Message;

// #19: what the E2E reports as a text before the handoff reply.
describe('textBeforeHandoff', () => {
	it('returns the text written before a successful handoff that a text follows, and nothing else', () => {
		const handoff = tool('handoffToDave', { ok: true });
		expect(textBeforeHandoff(reply([text('Your text triggers the out-of-area rule.'), handoff, text('Sorry.')]))).toBe('Your text triggers the out-of-area rule.');
		expect(textBeforeHandoff(reply([handoff, text('Sorry.')]))).toBe('');
		expect(textBeforeHandoff(reply([text('One moment.'), handoff]))).toBe('');
		expect(textBeforeHandoff(reply([text('<think>plan</think>'), handoff, text('Sorry.')]))).toBe('');
		expect(textBeforeHandoff(reply([tool('bookSlot', { ok: true }), text("You're booked."), handoff, text('Sorry.')]))).toBe('');
	});
});

// #21: a successful handoff's reply is the desk's text to the customer.
describe('said', () => {
	it('includes a successful handoff reply, in order, and leaves out a refused one', () => {
		expect(said(reply([text('Sure.'), tool('handoffToDave', { ok: true, reply: 'Sorry, Dave will contact you directly.' })]))).toBe('Sure. Sorry, Dave will contact you directly.');
		expect(said(reply([tool('handoffToDave', { ok: false, reason: 'missing-acres' }), text('How big is it?')]))).toBe('How big is it?');
	});
});
