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
      /** Server capture time (ISO 8601) of the message, when sent. */
      time?: string;
    }
  | { id: string; kind: 'reasoning'; text: string; done: boolean; time?: string };

/**
 * The part of a desk text the customer would see. The model sometimes leaks its
 * thinking into the reply (`<think>…</think>`, or only a closing `</think>` after the
 * thoughts); none of that is part of the text message (build-plan §16).
 */
export function visibleText(text: string): string {
  let shown = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const close = shown.toLowerCase().lastIndexOf('</think>');
  if (close >= 0) shown = shown.slice(close + '</think>'.length);
  const open = shown.toLowerCase().indexOf('<think>');
  if (open >= 0) shown = shown.slice(0, open);
  return shown.trim();
}

/**
 * Where a handoff's reply starts in an assistant message: the index of a successful
 * `handoffToDave` call that has a text after it. The reply is the one text the customer
 * gets for a handoff, so a text the model wrote before the call (once, "Your text
 * triggers the out-of-area rule…") is not shown. -1 when there is no such call: a
 * refused handoff, or one the desk never texted about, keeps every text.
 */
function handoffReplyAt(message: FlueConversationMessage): number {
  const call = message.parts.findIndex(
    (part) =>
      part.type === 'dynamic-tool' &&
      part.toolName === 'handoffToDave' &&
      part.state === 'output-available' &&
      typeof part.output === 'object' &&
      part.output !== null &&
      (part.output as { ok?: unknown }).ok === true,
  );
  return call >= 0 && message.parts.some((part, index) => index > call && part.type === 'text') ? call : -1;
}

/** One bubble per finished `text` part of a visible user or assistant message. */
export function toBubbles(messages: readonly FlueConversationMessage[], failedIds: readonly string[] = []): Bubble[] {
  const bubbles: Bubble[] = [];
  for (const message of messages) {
    if (message.display !== 'visible' || (message.role !== 'user' && message.role !== 'assistant')) continue;
    const replyAt = message.role === 'assistant' ? handoffReplyAt(message) : -1;
    message.parts.forEach((part, index) => {
      if (part.type !== 'text' || part.state !== 'done' || index < replyAt) return;
      const text = message.role === 'assistant' ? visibleText(part.text) : part.text.trim() && part.text;
      if (!text) return;
      const bubble: Bubble = {
        id: `${message.id}:${index}`,
        from: message.role === 'user' ? 'customer' : 'desk',
        text,
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
        const entry: JudgmentEntry = { id: `${message.id}:${index}`, kind: 'reasoning', text: part.text, done: part.state === 'done' };
        if (message.timestamp) entry.time = message.timestamp;
        entries.push(entry);
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
        if (message.timestamp) entry.time = message.timestamp;
        entries.push(entry);
      }
    });
  }
  return entries;
}

/**
 * A phone's whole thread as plain text for the clipboard, one "Sender: text" line per
 * bubble (owner request): `names` labels the customer's and the desk's side.
 */
export function phoneText(bubbles: readonly Bubble[], names: { customer: string; desk: string }): string {
  return bubbles.map((bubble) => `${bubble.from === 'customer' ? names.customer : names.desk}: ${bubble.text}`).join('\n');
}
