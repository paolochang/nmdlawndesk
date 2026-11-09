// Google Calendar sync in Dave's panel (build-plan §14): the notice before connecting,
// the panel's state from the snapshot, and the one-line message after Google's redirect.
import { addDays } from './calendar.ts';

export interface SyncWindow {
  from: string;
  to: string;
}

/** `google` in the calendar snapshot. */
export interface GoogleStatus {
  connected: boolean;
  window?: SyncWindow;
  syncing?: boolean;
  lastSync?: 'ok' | 'failed';
}

/** Today and the next 13 days in Dave's time zone: what a connect would sync. */
export function syncWindow(today: string): SyncWindow {
  return { from: today, to: addDays(today, 13) };
}

/** `2026-12-03` → `Thu, Dec 3`. */
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** What the reviewer agrees to before Google's consent screen. */
export function connectNotice(window: SyncWindow): string {
  return (
    `For testing, Dave's calendar from ${shortDate(window.from)} to ${shortDate(window.to)} will be copied into a new ` +
    `calendar named "Dave's Lawn Desk" in your Google account. The app cannot read, change, or delete any of your ` +
    `other calendars or events. Disconnect deletes everything it added.`
  );
}

export type GoogleView =
  | { kind: 'off' }
  | { kind: 'on'; label: string; syncing: boolean; failed: boolean };

/** Dave's panel: Connect when not connected; otherwise the synced dates and any failure. */
export function googleView(status: GoogleStatus | undefined): GoogleView {
  if (!status?.connected || !status.window) return { kind: 'off' };
  return {
    kind: 'on',
    label: `Synced to your Google Calendar · ${shortDate(status.window.from)} – ${shortDate(status.window.to)}`,
    syncing: Boolean(status.syncing),
    failed: status.lastSync === 'failed',
  };
}

const RETURN_MESSAGES: Record<string, string> = {
  connected: 'Google Calendar connected. Dave’s two weeks are being copied now.',
  denied: 'Google Calendar was not connected: access was not allowed.',
  state: 'Google Calendar was not connected: the link expired. Try Connect again.',
  exchange: 'Google Calendar was not connected: Google did not finish. Try Connect again.',
};

/**
 * The message for `?google=connected|failed&reason=…` after Google's redirect, and the
 * address without those parameters; undefined when the address has none.
 */
export function googleReturn(href: string): { message: string; cleaned: string } | undefined {
  const url = new URL(href);
  const result = url.searchParams.get('google');
  if (!result) return undefined;
  const reason = url.searchParams.get('reason') ?? 'exchange';
  url.searchParams.delete('google');
  url.searchParams.delete('reason');
  const message = result === 'connected' ? RETURN_MESSAGES.connected : (RETURN_MESSAGES[reason] ?? RETURN_MESSAGES.exchange);
  return { message, cleaned: `${url.pathname}${url.search}${url.hash}` };
}
