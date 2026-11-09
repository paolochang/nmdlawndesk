// Conversation ids and agent URLs (build-plan §3). The backend parses them
// strictly, so the format here must match `parseConversationId` there.

/** `<visitorId>:<generation>:<phone>`, served by the lawn-desk agent. */
export function customerConversationUrl(visitorId: string, generation: number, phone: string): string {
  return `/api/agents/lawn-desk/${visitorId}:${generation}:${phone}`;
}

/**
 * A fictional customer phone for "New customer": `+1555` and seven random
 * digits (E.164, 11 digits). `random` returns [0, 1); a number already in
 * `taken` is drawn again so a new customer never reopens an old conversation.
 */
export function newCustomerPhone(random: () => number = Math.random, taken: readonly string[] = []): string {
  for (;;) {
    const digits = String(Math.floor(random() * 10_000_000)).padStart(7, '0');
    const phone = `+1555${digits}`;
    if (!taken.includes(phone)) return phone;
  }
}
