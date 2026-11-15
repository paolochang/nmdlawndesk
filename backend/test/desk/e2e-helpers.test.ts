import { describe, expect, it } from 'vitest';
import { type Message, textBeforeHandoff } from '../../scripts/desk-api.ts';

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
