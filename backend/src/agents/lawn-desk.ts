'use agent';
import { type AgentProps, dispatch, useAgentStart, useModel, useTool } from '@flue/runtime';
import { daveConversationId, parseConversationId } from '../domain/conversation.ts';
import { DESK_MODEL, daveAlertMessage, daveBookingMessage, lawnDeskPrompt } from '../desk/prompts.ts';
import { deskTools } from '../desk/tools.ts';
import { visitorStore } from '../store/stub.ts';
import { DavePhone } from './dave-phone.ts';

/**
 * Dave's booking agent: one conversation per customer phone
 * (`<visitorId>:<generation>:<customerPhone>`, build-plan §3). The tools' logic
 * lives in src/desk/ and is tested in Node; this module only wires it to the
 * visitor's store and to Dave's phone.
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

	const daveId = daveConversationId(conversation.visitorId, conversation.generation);
	const tools = deskTools({
		conversation,
		store,
		async alertDave(alert) {
			await dispatch(DavePhone, { id: daveId, message: daveAlertMessage(alert) });
		},
		async tellDaveBooked(notice) {
			await dispatch(DavePhone, { id: daveId, message: daveBookingMessage(notice) });
		},
	});
	for (const tool of tools) useTool(tool);

	return lawnDeskPrompt();
}
