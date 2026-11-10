import { describe, expect, it } from 'vitest';
import { connectNotice, googleReturn, googleView, syncWindow } from './google.ts';

describe('Google Calendar in Dave’s panel (build-plan §14)', () => {
  it('the notice names today and today + 13 and promises nothing else is touched', () => {
    const window = syncWindow('2026-12-03');
    expect(window).toEqual({ from: '2026-12-03', to: '2026-12-16' });
    const notice = connectNotice(window);
    expect(notice).toContain('from Thu, Dec 3 to Wed, Dec 16');
    expect(notice).toContain("a new calendar named \"Dave's Lawn Desk\"");
    expect(notice).toContain('cannot read, change, or delete any of your other calendars or events');
    expect(notice).toContain('Disconnect deletes everything it added');
  });

  it('shows Connect, connected with dates, syncing, and failed from the snapshot', () => {
    expect(googleView(undefined)).toEqual({ kind: 'off' });
    expect(googleView({ connected: false })).toEqual({ kind: 'off' });
    const window = { from: '2026-12-03', to: '2026-12-16' };
    expect(googleView({ connected: true, window, lastSync: 'ok' })).toEqual({
      kind: 'on',
      label: 'Synced to Google Calendar · Thu, Dec 3 – Wed, Dec 16',
      syncing: false,
      failed: false,
    });
    expect(googleView({ connected: true, window, syncing: true })).toMatchObject({ syncing: true, failed: false });
    expect(googleView({ connected: true, window, lastSync: 'failed' })).toMatchObject({ failed: true });
  });

  it('reads ?google= after the redirect and gives the address without it', () => {
    expect(googleReturn('http://localhost:5180/')).toBeUndefined();
    expect(googleReturn('http://localhost:5180/?google=connected')).toEqual({
      message: 'Google Calendar connected. Dave’s two weeks are being copied now.',
      cleaned: '/',
    });
    expect(googleReturn('http://localhost:5180/?x=1&google=failed&reason=denied')).toEqual({
      message: 'Google Calendar was not connected: access was not allowed.',
      cleaned: '/?x=1',
    });
    expect(googleReturn('http://localhost:5180/?google=failed&reason=odd')?.message).toContain('Google did not finish');
  });
});
