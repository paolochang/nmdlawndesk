import { FlueApiError } from '@flue/sdk';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, fetchGeneration, reportingUnauthorized, resetCalendar, signIn, statusOf } from './api.ts';

const session = { visitorId: 'v123', token: 'payload.sig', expiresAt: 1_800_007_200 };

describe('signIn', () => {
  it('posts the access code and nickname and returns the session', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json(session));

    await expect(signIn(fetchFn, 'code', ' test-reviewer ')).resolves.toEqual(session);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/auth');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ accessCode: 'code', nickname: ' test-reviewer ' });
  });

  it('throws an ApiError with the status on a refused sign-in', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ error: 'unauthorized' }, { status: 401 }));
    const error = await signIn(fetchFn, 'bad', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(statusOf(error)).toBe(401);
  });
});

describe('fetchGeneration', () => {
  it('reads the generation from the visitor calendar with the bearer token', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ generation: 4, presetId: 'B', customers: [], bookings: [] }),
    );

    await expect(fetchGeneration(fetchFn, session)).resolves.toBe(4);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/calendar/v123');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer payload.sig');
  });

  it('throws an ApiError with the status when the calendar is refused', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('', { status: 401 }));
    expect(statusOf(await fetchGeneration(fetchFn, session).catch((e: unknown) => e))).toBe(401);
  });
});

describe('resetCalendar (Reset all)', () => {
  it('posts the reset with the bearer token and returns the new calendar', async () => {
    const fresh = { generation: 5, presetId: 'C', customers: [], bookings: [] };
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json(fresh));

    await expect(resetCalendar(fetchFn, session)).resolves.toEqual(fresh);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/calendar/v123/reset');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer payload.sig');
  });

  it('throws an ApiError with the status when the reset is refused', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('', { status: 429 }));
    expect(statusOf(await resetCalendar(fetchFn, session).catch((e: unknown) => e))).toBe(429);
  });
});

describe('statusOf', () => {
  it('reads the status of the SDK error a failed send rejects with', () => {
    expect(statusOf(new FlueApiError(409, { error: 'stale conversation', generation: 5 }))).toBe(409);
    expect(statusOf(new ApiError(429, 'too many requests'))).toBe(429);
    expect(statusOf(new Error('offline'))).toBeUndefined();
    expect(statusOf(undefined)).toBeUndefined();
  });
});

describe('reportingUnauthorized', () => {
  it('reports a 401 response and still returns it', async () => {
    const onUnauthorized = vi.fn();
    const fetchFn = reportingUnauthorized(async () => new Response('', { status: 401 }), onUnauthorized);

    expect((await fetchFn('/api/agents/lawn-desk/x')).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('stays quiet for other responses', async () => {
    const onUnauthorized = vi.fn();
    const fetchFn = reportingUnauthorized(async () => new Response('', { status: 409 }), onUnauthorized);
    await fetchFn('/api/agents/lawn-desk/x', { method: 'POST' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
