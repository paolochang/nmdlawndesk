'use agent';
import { type AgentProps, useAgentFinish, useAgentStart, useDataWriter, useDelivery, useModel, usePersistentState, useTool } from '@flue/runtime';
import { detailsGiven, detailsRetrySignal, shouldRetryForDetails } from '../desk/intake.ts';
import { DESK_MODEL, lawnDeskPrompt } from '../desk/prompts.ts';
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

	// The customer's texts (the latest ten), whether times were offered, and the text count the
	// desk was last sent back at (#22, build-plan §16).
	const delivery = useDelivery();
	const [texts, setTexts] = usePersistentState<string[]>('customerTexts', []);
	const [textCount, setTextCount] = usePersistentState('customerTextCount', 0);
	const [offered, setOffered] = usePersistentState('slotsOffered', false);
	const [handedOff, setHandedOff] = usePersistentState('handedOff', false);
	const [retriedAt, setRetriedAt] = usePersistentState('detailsRetriedAt', -1);
	const writeRetry = useDataWriter('details-retry');

	// Every delivered message records the phone; the store ignores a known one
	// and one from a generation a reset has left behind.
	// The greeting is the app's (frontend `GREETING`, build-plan §16): the desk never writes one.
	useAgentStart(async () => {
		if (delivery.kind === 'user' && typeof delivery.body === 'string') {
			const body = delivery.body;
			setTexts((previous) => [...previous, body].slice(-10));
			setTextCount((count) => count + 1);
		}
		await store.addCustomer(conversation.phone, conversation.generation);
	});

	// The desk sometimes asked again for details it had instead of calling the tools (#22):
	// send it back once per customer text. The marker lets the simulator drop the text it
	// wrote before (frontend `deskTexts`).
	useAgentFinish(({ response, append, log }) => {
		const details = detailsGiven(texts);
		const toolCalls = response.toolCalls.filter((call) => !call.isError).map((call) => call.tool);
		if (!details || !shouldRetryForDetails({ toolCalls, details, offered, handedOff, retriedAt, texts: textCount })) return;
		setRetriedAt(textCount);
		try {
			writeRetry({ at: textCount });
		} catch (error) {
			log.warn?.(`details-retry marker not written: ${String(error)}`);
		}
		append(detailsRetrySignal(details));
	});

	const tools = deskTools({ conversation, store, onSlotsOffered: () => setOffered(true), onHandedOff: () => setHandedOff(true) });
	for (const tool of tools) useTool(tool);

	return lawnDeskPrompt(localDateTime(Date.now(), RULES.timeZone));
}
