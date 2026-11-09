import { useEffect, useRef } from 'react';
import { connectNotice, googleView, syncWindow, type GoogleStatus } from './lib/google.ts';

/** A plain calendar mark for the Google Calendar controls (not Google's logo). */
function CalendarIcon() {
  return (
    <svg className="gcal-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <text x="12" y="17.6" textAnchor="middle">
        G
      </text>
    </svg>
  );
}

interface ButtonProps {
  status: GoogleStatus | undefined;
  /** Dave's today, for the dates the notice names; undefined until the calendar loads. */
  today: string | undefined;
  busy: boolean;
  noticeOpen: boolean;
  onOpenNotice: () => void;
  onCloseNotice: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

/**
 * Next to Dave's name in the panel header (build-plan §14, owner E2E): **Sync** opens a
 * popup with the notice; only **Agree and connect** goes to Google. Once connected the
 * button is **Disconnect**.
 */
export function GoogleSyncButton({ status, today, busy, noticeOpen, onOpenNotice, onCloseNotice, onConnect, onDisconnect }: ButtonProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (noticeOpen && !element.open) element.showModal();
    if (!noticeOpen && element.open) element.close();
  }, [noticeOpen]);

  if (!today) return null;
  const connected = googleView(status).kind === 'on';
  return (
    <>
      {connected ? (
        <button type="button" className="gcal-btn" disabled={busy} onClick={onDisconnect} title="Stop syncing and delete the Dave's Lawn Desk calendar from your Google account">
          <CalendarIcon />
          {busy ? 'Disconnecting…' : 'Disconnect'}
        </button>
      ) : (
        <button type="button" className="gcal-btn" onClick={onOpenNotice} title="Copy Dave's next two weeks into your Google Calendar">
          <CalendarIcon />
          Sync
        </button>
      )}
      <dialog ref={dialog} className="gcal-dialog" aria-labelledby="gcal-title" onClose={onCloseNotice}>
        <h3 id="gcal-title">
          <CalendarIcon /> Sync with Google Calendar
        </h3>
        <p>{connectNotice(syncWindow(today))}</p>
        <div className="gcal-actions">
          <button type="button" className="primary" disabled={busy} onClick={onConnect}>
            {busy ? 'Opening Google…' : 'Agree and connect'}
          </button>
          <button type="button" disabled={busy} onClick={onCloseNotice}>
            Cancel
          </button>
        </div>
      </dialog>
    </>
  );
}

interface NoteProps {
  status: GoogleStatus | undefined;
  /** The last connect/disconnect outcome, one line. */
  message: string | undefined;
}

/** Beside the demo calendar's title: the synced dates, syncing, a failure, and the last outcome. */
export function GoogleSyncNote({ status, message }: NoteProps) {
  const view = googleView(status);
  if (view.kind === 'off' && !message) return null;
  return (
    <span className="cal-sync">
      {view.kind === 'on' && (
        <>
          <a href="https://calendar.google.com/" target="_blank" rel="noreferrer">
            {view.label}
          </a>
          {view.syncing && <em> · syncing…</em>}
          {view.failed && <b className="cal-sync-error"> · Google Calendar sync failed</b>}
        </>
      )}
      {message && <span className="cal-sync-message">{view.kind === 'on' ? ` · ${message}` : message}</span>}
    </span>
  );
}
