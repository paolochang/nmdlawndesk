// Turns the customer conversation's messages into what the simulator shows:
// SMS bubbles, the "typing…" state, and the judgment log (build-plan §7).
import type { AgentStatus, FlueConversationMessage } from '@flue/react';

export interface Bubble {
  id: string;
  from: 'customer' | 'desk';
  text: string;
  /** The customer's text was not admitted (the hook's `failedSends`). */
  failed?: true;
}

export type JudgmentEntry =
  | {
      id: string;
      kind: 'tool';
      toolName: string;
      state: 'input-available' | 'output-available' | 'output-error';
      input: unknown;
      output?: unknown;
      errorText?: string;
    }
  | { id: string; kind: 'reasoning'; text: string; done: boolean };

/** One bubble per finished `text` part of a visible user or assistant message. */
export function toBubbles(messages: readonly FlueConversationMessage[], failedIds: readonly string[] = []): Bubble[] {
  const bubbles: Bubble[] = [];
  for (const message of messages) {
    if (message.display !== 'visible' || (message.role !== 'user' && message.role !== 'assistant')) continue;
    message.parts.forEach((part, index) => {
      if (part.type !== 'text' || part.state !== 'done' || !part.text.trim()) return;
      const bubble: Bubble = {
        id: `${message.id}:${index}`,
        from: message.role === 'user' ? 'customer' : 'desk',
        text: part.text,
      };
      if (failedIds.includes(message.id)) bubble.failed = true;
      bubbles.push(bubble);
    });
  }
  return bubbles;
}

/** "typing…" while a prompt is being admitted or the reply is still streaming. */
export function isTyping(status: AgentStatus): boolean {
  return status === 'submitted' || status === 'streaming';
}

/**
 * The desk failed to reply to an admitted text (the hook reports `error` with no
 * failed send of ours), so the phone says so instead of going quiet.
 */
export function replyFailed(status: AgentStatus, failedSends: number): boolean {
  return status === 'error' && failedSends === 0;
}

/** Tool calls (`dynamic-tool`) and `reasoning` parts, in conversation order. */
export function toJudgmentLog(messages: readonly FlueConversationMessage[]): JudgmentEntry[] {
  const entries: JudgmentEntry[] = [];
  for (const message of messages) {
    message.parts.forEach((part, index) => {
      if (part.type === 'reasoning') {
        entries.push({ id: `${message.id}:${index}`, kind: 'reasoning', text: part.text, done: part.state === 'done' });
      } else if (part.type === 'dynamic-tool') {
        const entry: JudgmentEntry = {
          id: part.toolCallId,
          kind: 'tool',
          toolName: part.toolName,
          state: part.state,
          input: part.input,
        };
        if (part.state === 'output-available') entry.output = part.output;
        if (part.state === 'output-error') entry.errorText = part.errorText;
        entries.push(entry);
      }
    });
  }
  return entries;
}
