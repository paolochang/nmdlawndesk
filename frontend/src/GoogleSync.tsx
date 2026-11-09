import { useState } from 'react';
import { connectNotice, googleView, syncWindow, type GoogleStatus } from './lib/google.ts';

interface Props {
  status: GoogleStatus | undefined;
  /** Dave's today, for the dates the notice names. */
  today: string;
  /** The last connect/disconnect outcome, one line. */
  message: string | undefined;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

/**
 * Google Calendar in Dave's panel (build-plan §14): Connect opens a notice naming the
 * two weeks first; only **Agree and connect** goes to Google.
 */
export function GoogleSync({ status, today, message, busy, onConnect, onDisconnect }: Props) {
  const [noticeOpen, setNoticeOpen] = useState(false);
  const view = googleView(status);
  return (
    <section className="google-sync" aria-label="Google Calendar">
      {view.kind === 'off' ? (
        noticeOpen ? (
          <div className="google-notice" role="group" aria-label="Before connecting">
            <p>{connectNotice(syncWindow(today))}</p>
            <div className="google-actions">
              <button type="button" className="primary" disabled={busy} onClick={onConnect}>
                {busy ? 'Opening Google…' : 'Agree and connect'}
              </button>
              <button type="button" disabled={busy} onClick={() => setNoticeOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="google-row">
            <span>See Dave's next two weeks in your own Google Calendar.</span>
            <button type="button" onClick={() => setNoticeOpen(true)}>
              Connect Google Calendar
            </button>
          </div>
        )
      ) : (
        <div className="google-row">
          <span>
            {view.label}
            {view.syncing && <em> · syncing…</em>}
          </span>
          <a href="https://calendar.google.com/" target="_blank" rel="noreferrer">
            Open Google Calendar
          </a>
          <button type="button" disabled={busy} onClick={onDisconnect}>
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      )}
      {view.kind === 'on' && view.failed && <p className="google-error">Google Calendar sync failed.</p>}
      {message && <p className="google-message">{message}</p>}
    </section>
  );
}
