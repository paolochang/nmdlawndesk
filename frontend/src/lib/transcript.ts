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

type Part = FlueConversationMessage['parts'][number];

const okOutput = (part: Part): Record<string, unknown> | undefined =>
  part.type === 'dynamic-tool' &&
  part.state === 'output-available' &&
  typeof part.output === 'object' &&
  part.output !== null &&
  (part.output as { ok?: unknown }).ok === true
    ? (part.output as Record<string, unknown>)
    : undefined;

/** A successful `handoffToDave` call's reply: since #21 the turn ends there, so it is the desk's text. */
function handoffReply(part: Part): string | undefined {
  if (part.type !== 'dynamic-tool' || part.toolName !== 'handoffToDave') return undefined;
  const reply = okOutput(part)?.reply;
  return typeof reply === 'string' && reply.trim() ? reply : undefined;
}

/** The last sentence of a reply, which a copy of it contains ("…once he's done mowing for the day."). */
const lastSentence = (reply: string) => reply.trim().split(/(?<=[.!?])\s+/).at(-1) ?? reply;

export interface DeskText {
  /** The part the text comes from: a `text` part, or the `handoffToDave` call whose reply it is. */
  index: number;
  text: string;
}

/**
 * The texts one assistant message sent the customer, in order (build-plan §7, §16). A
 * successful `handoffToDave` call's reply is the desk's text for that turn (#21: the turn
 * ends there). What the model wrote before the call is not sent (#19: once, "Your text
 * triggers the out-of-area rule…"), unless the reply also booked, whose confirmation the
 * customer needs; a copy of the reply written after the call is not sent twice.
 * `replying`: this message is still being written, so a handoff call under way already
 * holds back the text before it. Every reader of desk texts (bubbles, status, suggestions)
 * uses this, so they agree.
 */
export function deskTexts(message: FlueConversationMessage, replying = false): DeskText[] {
  if (message.role !== 'assistant') return [];
  const parts = message.parts;
  const booked = parts.some((part) => part.type === 'dynamic-tool' && part.toolName === 'bookSlot' && okOutput(part) !== undefined);
  const handoffs = parts.flatMap((part, index) => {
    const reply = handoffReply(part);
    return reply ? [{ index, reply }] : [];
  });
  const pending = replying ? parts.findLastIndex((part) => part.type === 'dynamic-tool' && part.toolName === 'handoffToDave' && part.state === 'input-available') : -1;
  const holdBefore = booked ? -1 : Math.max(handoffs.at(-1)?.index ?? -1, pending);
  const texts: DeskText[] = [];
  parts.forEach((part, index) => {
    const reply = handoffReply(part);
    if (reply) {
      texts.push({ index, text: reply });
      return;
    }
    if (part.type !== 'text' || part.state !== 'done' || index < holdBefore) return;
    const text = visibleText(part.text);
    if (!text) return;
    if (handoffs.some((h) => h.index < index && text.includes(lastSentence(h.reply)))) return;
    texts.push({ index, text });
  });
  return texts;
}

/**
 * One bubble per text the customer got: their own finished `text` parts, and the desk's
 * texts (`deskTexts`). `replying`: the desk is still answering the last message.
 */
export function toBubbles(messages: readonly FlueConversationMessage[], failedIds: readonly string[] = [], replying = false): Bubble[] {
  const bubbles: Bubble[] = [];
  messages.forEach((message, position) => {
    if (message.display !== 'visible' || (message.role !== 'user' && message.role !== 'assistant')) return;
    const texts =
      message.role === 'assistant'
        ? deskTexts(message, replying && position === messages.length - 1)
        : message.parts.flatMap((part, index) => (part.type === 'text' && part.state === 'done' && part.text.trim() ? [{ index, text: part.text }] : []));
    for (const { index, text } of texts) {
      const bubble: Bubble = { id: `${message.id}:${index}`, from: message.role === 'user' ? 'customer' : 'desk', text };
      if (failedIds.includes(message.id)) bubble.failed = true;
      bubbles.push(bubble);
    }
  });
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
