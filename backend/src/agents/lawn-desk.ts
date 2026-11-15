'use agent';
import { type AgentProps, useAgentStart, useModel, useTool } from '@flue/runtime';
import { parseConversationId } from '../domain/conversation.ts';
import { RULES } from '../domain/rules.ts';
import { localDateTime } from '../domain/time.ts';
import { DESK_MODEL, lawnDeskPrompt } from '../desk/prompts.ts';
import { deskTools } from '../desk/tools.ts';
import { visitorStore } from '../store/stub.ts';

/**
 * Dave's booking agent: one conversation per customer phone
 * (`<visitorId>:<generation>:<customerPhone>`, build-plan §3). The tools' logic
 * lives in src/desk/ and is tested in Node; this module only wires it to the
 * visitor's store, which also keeps Dave's texts (build-plan §13).
 */
export function LawnDesk({ id }: AgentProps) {
	useModel(DESK_MODEL);
	const conversation = parseConversationId(id);
	if (conversation?.kind !== 'customer') throw new Error(`LawnDesk serves customer conversations only, got ${id}`);
	const store = visitorStore(conversation.visitorId);

	// Every delivered message records the phone; the store ignores a known one
	// and one from a generation a reset has left behind.
	useAgentStart(async () => {
		await store.addCustomer(conversation.phone, conversation.generation);
	});

	const tools = deskTools({ conversation, store });
	for (const tool of tools) useTool(tool);

	return lawnDeskPrompt(localDateTime(Date.now(), RULES.timeZone));
}
