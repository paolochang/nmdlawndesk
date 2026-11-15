import type { CloudflareAIBinding } from '@flue/runtime/cloudflare/workers-ai';
import { DESK_MODEL } from './prompts.ts';

/**
 * Whether the desk's model thinks (build-plan §16). Flue sends only `reasoning_effort`,
 * which Workers AI ignores for `glm-4.7-flash`; the model's chat template does honour
 * `chat_template_kwargs.enable_thinking = false` (spike, 2026-11-14: no reasoning, 21
 * output tokens instead of 400+). Kept on (owner, 2026-11-14): the first live run
 * without thinking quoted $67.50 for half an acre and called no tool; the prompt asks
 * for thinking in three key points instead.
 */
export const DESK_THINKING_OFF = false;

/** Workers AI model ids whose thinking is turned off. */
export const THINKING_OFF_MODELS: readonly string[] = DESK_THINKING_OFF ? [DESK_MODEL.replace(/^cloudflare\//, '')] : [];

/**
 * The Workers AI binding with thinking turned off for `models`: their requests gain
 * `chat_template_kwargs.enable_thinking = false`; every other request passes unchanged.
 */
export function withoutThinking(ai: CloudflareAIBinding, models: readonly string[] = THINKING_OFF_MODELS): CloudflareAIBinding {
	return {
		run(modelId, inputs, options) {
			if (!models.includes(modelId)) return ai.run(modelId, inputs, options);
			const kwargs = typeof inputs.chat_template_kwargs === 'object' && inputs.chat_template_kwargs !== null ? inputs.chat_template_kwargs : {};
			return ai.run(modelId, { ...inputs, chat_template_kwargs: { ...kwargs, enable_thinking: false } }, options);
		},
	};
}
