// The two plain HTTP calls the simulator makes outside the Flue client.
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

/** The visitor's current generation, from `GET /api/calendar/<visitorId>`. */
export async function fetchGeneration(fetchFn: typeof fetch, session: Session): Promise<number> {
  const response = await fetchFn(`/api/calendar/${session.visitorId}`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  if (!response.ok) throw new ApiError(response.status, `calendar failed (${response.status})`);
  const { generation } = (await response.json()) as { generation: number };
  return generation;
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
