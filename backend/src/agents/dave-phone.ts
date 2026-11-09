'use agent';
import { type AgentProps, useModel } from '@flue/runtime';
import { parseConversationId } from '../domain/conversation.ts';
import { DAVE_PHONE_PROMPT, DESK_MODEL } from '../desk/prompts.ts';

/**
 * Dave's phone: one conversation per visitor and generation (`<visitorId>:<generation>:dave`).
 * Until build-plan §13 the desk posted `<handoff>` and `<booking>` signals here and
 * this agent texted Dave. Dave's texts are now fixed templates in the visitor store;
 * the mount is read-only and only keeps older conversations open.
 */
export function DavePhone({ id }: AgentProps) {
	useModel(DESK_MODEL);
	if (parseConversationId(id)?.kind !== 'dave') throw new Error(`DavePhone serves Dave conversations only, got ${id}`);
	return DAVE_PHONE_PROMPT;
}
