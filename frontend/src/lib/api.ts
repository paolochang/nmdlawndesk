// The plain HTTP calls the simulator makes outside the Flue client.
import type { CalendarSnapshot } from './calendar.ts';
import type { DaveConfig } from './config.ts';
import type { Session } from './session.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** `POST /api/auth`. Throws `ApiError` (401 for a wrong code or nickname). */
export async function signIn(fetchFn: typeof fetch, accessCode: string, nickname: string): Promise<Session> {
  const response = await fetchFn('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessCode, nickname }),
  });
  if (!response.ok) throw new ApiError(response.status, `sign-in failed (${response.status})`);
  const { visitorId, token, expiresAt } = (await response.json()) as Session;
  return { visitorId, token, expiresAt };
}

/** The visitor's calendar (generation, bookings), from `GET /api/calendar/<visitorId>`. */
export async function fetchCalendar(fetchFn: typeof fetch, session: Session): Promise<CalendarSnapshot> {
  const response = await fetchFn(`/api/calendar/${session.visitorId}`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  if (!response.ok) throw new ApiError(response.status, `calendar failed (${response.status})`);
  return (await response.json()) as CalendarSnapshot;
}

/** The visitor's current generation. */
export async function fetchGeneration(fetchFn: typeof fetch, session: Session): Promise<number> {
  return (await fetchCalendar(fetchFn, session)).generation;
}

/** **Reset all**: `POST /api/calendar/<visitorId>/reset`, a new generation with a different seed preset. */
export async function resetCalendar(fetchFn: typeof fetch, session: Session): Promise<CalendarSnapshot> {
  const response = await fetchFn(`/api/calendar/${session.visitorId}/reset`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.token}` },
  });
  if (!response.ok) throw new ApiError(response.status, `reset failed (${response.status})`);
  return (await response.json()) as CalendarSnapshot;
}

/** Dave's rules, from the public `GET /api/config`. */
export async function fetchConfig(fetchFn: typeof fetch): Promise<DaveConfig> {
  const response = await fetchFn('/api/config');
  if (!response.ok) throw new ApiError(response.status, `config failed (${response.status})`);
  return (await response.json()) as DaveConfig;
}

/** HTTP status of an `ApiError`, the SDK's `FlueApiError`, or a stream `FetchError`. */
export function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

/** Wraps fetch so any 401 response also reports `onUnauthorized` (the token expired). */
export function reportingUnauthorized(fetchFn: typeof fetch, onUnauthorized: () => void): typeof fetch {
  return async (input, init) => {
    const response = await fetchFn(input, init);
    if (response.status === 401) onUnauthorized();
    return response;
  };
}
