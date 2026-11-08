// Recovery for a text refused with 409: Dave's calendar moved to a new
// generation (a reset elsewhere), so the conversation id is stale (build-plan §7).
import { customerConversationUrl } from './conversation.ts';

export interface StaleSend {
  visitorId: string;
  /** The customer phone the text was typed on, even if New customer was clicked since. */
  phone: string;
  /** The generation the refused text was sent to. */
  generation: number;
  text: string;
}

export interface RecoverDeps {
  fetchGeneration: () => Promise<number>;
  /** Sends one customer text into the conversation at `url`. */
  sendTo: (url: string, text: string) => Promise<unknown>;
}

export type Recovery = { ok: true; generation: number } | { ok: false; error?: unknown };

/**
 * Refetches the generation and re-sends the text, on the phone it was typed on,
 * into that phone's conversation of the new generation. Each refused text
 * recovers on its own, so concurrent refusals cannot overwrite each other.
 */
export async function recoverStaleSend(stale: StaleSend, deps: RecoverDeps): Promise<Recovery> {
  let generation: number;
  try {
    generation = await deps.fetchGeneration();
  } catch (error) {
    return { ok: false, error };
  }
  if (generation <= stale.generation) return { ok: false };
  try {
    await deps.sendTo(customerConversationUrl(stale.visitorId, generation, stale.phone), stale.text);
  } catch (error) {
    return { ok: false, error };
  }
  return { ok: true, generation };
}
