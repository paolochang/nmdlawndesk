import { describe, expect, it } from 'vitest';
import { type Message, said, textBeforeHandoff, wrote } from '../../scripts/desk-api.ts';

const text = (value: string) => ({ type: 'text', text: value, state: 'done' });
const tool = (toolName: string, output: unknown) => ({ type: 'dynamic-tool', toolName, state: 'output-available', output });
const reply = (parts: object[]) => ({ role: 'assistant', purpose: 'assistant', parts }) as Message;

// #19: what the E2E reports as a text before the handoff reply.
describe('textBeforeHandoff', () => {
	it('returns the text written before a successful handoff, and nothing else', () => {
		const handoff = tool('handoffToDave', { ok: true });
		expect(textBeforeHandoff(reply([text('Your text triggers the out-of-area rule.'), handoff, text('Sorry.')]))).toBe('Your text triggers the out-of-area rule.');
		expect(textBeforeHandoff(reply([handoff, text('Sorry.')]))).toBe('');
		expect(textBeforeHandoff(reply([text('One moment.'), handoff]))).toBe('');
		// Codex review of #20 (P2): with terminate the reply is in the tool output and no text follows the call.
		expect(textBeforeHandoff(reply([text('Your text triggers the rule.'), tool('handoffToDave', { ok: true, reply: 'Sorry.' })]))).toBe('Your text triggers the rule.');
		expect(textBeforeHandoff(reply([text('<think>plan</think>'), handoff, text('Sorry.')]))).toBe('');
		expect(textBeforeHandoff(reply([tool('bookSlot', { ok: true }), text("You're booked."), handoff, text('Sorry.')]))).toBe('');
	});
});

// #21 and holistic review (P3-1): said() is what the customer got, by the same rules as the
// simulator's bubbles; wrote() is the model's own text, for checks on what the model did.
describe('said and wrote', () => {
	const handoff = (value: string) => tool('handoffToDave', { ok: true, reply: value });
	it('counts the handoff reply and leaves out the text held back before it and a refused handoff', () => {
		expect(said(reply([text('Your text triggers the rule.'), handoff('Sorry. He will call.')]))).toBe('Sorry. He will call.');
		expect(said(reply([tool('handoffToDave', { ok: false, reason: 'missing-acres' }), text('How big is it?')]))).toBe('How big is it?');
	});
	it('keeps a confirmation, drops copied sentences and greetings, like the bubbles', () => {
		expect(said(reply([tool('bookSlot', { ok: true }), text("You're booked."), handoff('Sorry. He will call.')]))).toBe("You're booked. Sorry. He will call.");
		expect(said(reply([tool('bookSlot', { ok: true }), handoff('Sorry. He will call.'), text("You're booked. Sorry. He will call.")]))).toBe("Sorry. He will call. You're booked.");
		expect(said(reply([text("Thanks for reaching out to Dave's Lawn Desk! I'm Dave's booking assistant. It's $45.")]))).toBe("It's $45.");
	});
	it('wrote() keeps the model text as written', () => {
		expect(wrote(reply([text("Thanks for reaching out! It's $45."), handoff('Sorry.')]))).toBe("Thanks for reaching out! It's $45.");
	});
});

// #22: the desk was sent back to the tools after asking again for details it had.
describe('said after a details retry', () => {
	it('counts the reply after the marker, not the question before it', () => {
		const marker = { type: 'data-details-retry' };
		expect(said(reply([text("What's the yard size?"), marker, tool('findSlots', { slots: [] }), text("It's $45. Mon 8 AM or Thu 9 AM?")]))).toBe("It's $45. Mon 8 AM or Thu 9 AM?");
		expect(said(reply([text("What's the yard size?"), marker]))).toBe("What's the yard size?");
		expect(said(reply([text('We take cash.'), text("What's the yard size?"), marker, text("It's $45.")]))).toBe("We take cash. It's $45.");
	});
});
