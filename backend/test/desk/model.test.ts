import { describe, expect, it, vi } from 'vitest';
import { withoutThinking } from '../../src/desk/model.ts';

describe('withoutThinking (build-plan §16)', () => {
	it("turns the desk model's thinking off and leaves other models alone", async () => {
		const run = vi.fn(async () => ({}));
		const ai = withoutThinking({ run }, ['@cf/zai-org/glm-4.7-flash']);
		await ai.run('@cf/zai-org/glm-4.7-flash', { messages: [], chat_template_kwargs: { keep: 1 } }, { gateway: { id: 'default' } });
		await ai.run('@cf/other/model', { messages: [] });
		expect(run).toHaveBeenNthCalledWith(
			1,
			'@cf/zai-org/glm-4.7-flash',
			{ messages: [], chat_template_kwargs: { keep: 1, enable_thinking: false } },
			{ gateway: { id: 'default' } },
		);
		expect(run).toHaveBeenNthCalledWith(2, '@cf/other/model', { messages: [] }, undefined);
	});
});
