// Message builders for the Node tests of the simulator's UI logic.
import type { FlueConversationMessage, FlueConversationPart } from '@flue/react';

export function message(
  id: string,
  role: FlueConversationMessage['role'],
  parts: FlueConversationPart[],
  extra: Partial<FlueConversationMessage> = {},
): FlueConversationMessage {
  const purpose = role === 'system' ? 'dispatch' : role;
  return { id, role, purpose, display: 'visible', parts, ...extra };
}

export function text(value: string): FlueConversationPart {
  return { type: 'text', text: value, state: 'done' };
}

export function done(toolCallId: string, toolName: string, input: unknown, output: unknown): FlueConversationPart {
  return { type: 'dynamic-tool', toolName, toolCallId, state: 'output-available', input, output };
}

export function running(toolCallId: string, toolName: string, input: unknown): FlueConversationPart {
  return { type: 'dynamic-tool', toolName, toolCallId, state: 'input-available', input };
}
