import type { BookingStatus } from './lib/status.ts';

interface SuggestedProps {
  replies: string[];
  /** The desk is replying; picks come back once its text arrives. */
  waiting: boolean;
  disabled: boolean;
  onPick: (text: string) => void;
}

// Fixed replies for the current stage of the conversation; clicking one sends it.
export function SuggestedReplies({ replies, waiting, disabled, onPick }: SuggestedProps) {
  return (
    <div className="card">
      <div className="card-top">
        <h3>Suggested replies</h3>
        <span className="hint">Click to send, or type in the phone</span>
      </div>
      {waiting && <p className="hint">Waiting for the desk's reply…</p>}
      <div className="chip-list">
        {replies.map((reply) => (
          <button key={reply} type="button" className="chip" disabled={disabled} onClick={() => onPick(reply)}>
            {reply}
          </button>
        ))}
      </div>
    </div>
  );
}

const REASON: Record<string, string> = {
  'out-of-area': 'outside the area',
  'yard-over-1-acre': 'yard over 1 acre',
  complaint: 'complaint',
  refund: 'refund request',
  haggling: 'haggling',
  other: 'needs Dave',
};
const reason = (key: string) => REASON[key] ?? key;

// The current customer's booking, or that the desk handed them to Dave.
export function BookingStatusCard({ status }: { status: BookingStatus }) {
  return (
    <div className="card booking">
      <div className="card-top">
        <h3>Booking status</h3>
        <span className={`status ${status.kind}`}>
          {status.kind === 'booked' ? 'Booked' : status.kind === 'with-dave' ? 'With Dave' : 'No booking yet'}
        </span>
      </div>
      {status.kind === 'booked' && (
        <>
          <dl>
            <dt>When</dt>
            <dd>{status.when}</dd>
            <dt>Where</dt>
            <dd>{status.address}</dd>
            <dt>Price</dt>
            <dd>
              {status.price} · {status.duration}
            </dd>
            <dt>Booking</dt>
            <dd>{status.bookingId}</dd>
          </dl>
          <p className="hint">
            {status.handedOff && `Also passed to Dave (${reason(status.handedOff)}). `}The final price may change on site.
          </p>
        </>
      )}
      {status.kind === 'with-dave' && (
        <p className="hint">No booking. The desk handed this customer to Dave ({reason(status.reason)}); Dave will contact them directly.</p>
      )}
      {status.kind === 'open' && <p className="hint">Book a time by texting. It shows here once the desk confirms it.</p>}
    </div>
  );
}
