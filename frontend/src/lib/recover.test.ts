import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api.ts';
import { recoverStaleSend } from './recover.ts';

const stale = { visitorId: 'v123', phone: '+15550000001', generation: 2, text: 'Half an acre in Ashford' };

describe('recoverStaleSend', () => {
  it('re-sends the text on its own phone in the new generation', async () => {
    const sendTo = vi.fn(async () => ({ submissionId: 's1' }));

    const result = await recoverStaleSend(stale, { fetchGeneration: async () => 3, sendTo });

    expect(result).toEqual({ ok: true, generation: 3 });
    expect(sendTo).toHaveBeenCalledExactlyOnceWith('/api/agents/lawn-desk/v123:3:+15550000001', 'Half an acre in Ashford');
  });

  it('recovers each refused text independently', async () => {
    const sendTo = vi.fn(async () => ({}));
    const deps = { fetchGeneration: async () => 3, sendTo };

    const results = await Promise.all([
      recoverStaleSend({ ...stale, text: 'first' }, deps),
      recoverStaleSend({ ...stale, phone: '+15550000002', text: 'second' }, deps),
    ]);

    expect(results).toEqual([{ ok: true, generation: 3 }, { ok: true, generation: 3 }]);
    expect(sendTo.mock.calls).toEqual([
      ['/api/agents/lawn-desk/v123:3:+15550000001', 'first'],
      ['/api/agents/lawn-desk/v123:3:+15550000002', 'second'],
    ]);
  });

  it('does not re-send when the generation did not move or cannot be read', async () => {
    const sendTo = vi.fn(async () => ({}));

    expect(await recoverStaleSend(stale, { fetchGeneration: async () => 2, sendTo })).toEqual({ ok: false });
    const refused = new ApiError(401, 'calendar failed (401)');
    expect(
      await recoverStaleSend(stale, { fetchGeneration: async () => Promise.reject(refused), sendTo }),
    ).toEqual({ ok: false, error: refused });
    expect(sendTo).not.toHaveBeenCalled();
  });

  it('reports a re-send that fails', async () => {
    const limited = new ApiError(429, 'too many requests');
    const result = await recoverStaleSend(stale, {
      fetchGeneration: async () => 3,
      sendTo: async () => Promise.reject(limited),
    });
    expect(result).toEqual({ ok: false, error: limited });
  });
});
