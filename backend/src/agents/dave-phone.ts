'use agent';
import { type AgentProps, useModel } from '@flue/runtime';
import { parseConversationId } from '../domain/conversation.ts';
import { DAVE_PHONE_PROMPT, DESK_MODEL } from '../desk/prompts.ts';

/**
 * Dave's phone: one conversation per visitor and generation (`<visitorId>:<generation>:dave`).
 * The lawn desk's handoffToDave posts `<handoff>` signals here server-side with
 * dispatch(), and this agent texts Dave the alert (build-plan §4, §11).
 */
export function DavePhone({ id }: AgentProps) {
	useModel(DESK_MODEL);
	if (parseConversationId(id)?.kind !== 'dave') throw new Error(`DavePhone serves Dave conversations only, got ${id}`);
	return DAVE_PHONE_PROMPT;
}
