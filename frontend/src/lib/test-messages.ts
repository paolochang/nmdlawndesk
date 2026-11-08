// Message builders and fixtures for the Node tests of the simulator's UI logic.
import type { FlueConversationMessage, FlueConversationPart } from '@flue/react';
import type { DaveConfig } from './config.ts';

/** `GET /api/config` as the backend serves it (backend `RULES`). */
export const config: DaveConfig = {
  timeZone: 'America/New_York',
  hours: { open: '08:00', close: '13:00' },
  slotStepMinutes: 30,
  minNoticeMinutes: 60,
  searchDays: 14,
  townGroups: [
    { weekdays: [1, 4], towns: ['Ashford', 'Clearwater'] },
    { weekdays: [2, 5], towns: ['Birchwood', 'Dunmore'] },
  ],
  hourlyRateCents: 4500,
  priceTable: [
    { maxAcres: 0.5, durationMinutes: 60 },
    { maxAcres: 1, durationMinutes: 90 },
  ],
  unknownSizeDurationMinutes: 60,
};

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
