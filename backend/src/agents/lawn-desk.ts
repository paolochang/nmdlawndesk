'use agent';
import { type AgentProps, useAgentStart, useModel, usePersistentState, useTool } from '@flue/runtime';
import { DESK_MODEL, FIRST_TEXT_NOTE, lawnDeskPrompt } from '../desk/prompts.ts';
import { parseConversationId } from '../domain/conversation.ts';
import { RULES } from '../domain/rules.ts';
import { localDateTime } from '../domain/time.ts';
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

	// The customer's texts so far. Only their first text gets a note asking the desk to
	// open with a thank-you (owner E2E, build-plan §16): a signal, because changing the
	// prompt mid-conversation made Flue post an "instructions changed" notice.
	const [texts, setTexts] = usePersistentState('customerTexts', 0);
	const firstText = texts === 0;

	// Every delivered message records the phone; the store ignores a known one
	// and one from a generation a reset has left behind.
	useAgentStart(async ({ append }) => {
		if (firstText) append(FIRST_TEXT_NOTE);
		setTexts((count) => count + 1);
		await store.addCustomer(conversation.phone, conversation.generation);
	});

	const tools = deskTools({ conversation, store });
	for (const tool of tools) useTool(tool);

	return lawnDeskPrompt(localDateTime(Date.now(), RULES.timeZone));
}
