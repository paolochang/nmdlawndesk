'use agent';
import { type AgentProps, useAgentStart, useModel, usePersistentState, useTool } from '@flue/runtime';
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

	// Customer texts this conversation has delivered, so only the desk's first reply
	// thanks the customer for reaching out (owner E2E, build-plan §16). Counted when a
	// text arrives, before the model reads it.
	const [texts, setTexts] = usePersistentState('customerTexts', 0);

	// Every delivered message records the phone; the store ignores a known one
	// and one from a generation a reset has left behind.
	useAgentStart(async () => {
		setTexts((count) => count + 1);
		await store.addCustomer(conversation.phone, conversation.generation);
	});

	const tools = deskTools({ conversation, store });
	for (const tool of tools) useTool(tool);

	return lawnDeskPrompt(localDateTime(Date.now(), RULES.timeZone), texts <= 1);
}
