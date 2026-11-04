import { type FormEvent } from 'react';
import { useStickToBottom } from './useStickToBottom.ts';
import type { Bubble } from './lib/transcript.ts';

interface Props {
  phone: string;
  bubbles: Bubble[];
  typing: boolean;
  ready: boolean;
  notice: string | undefined;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: (text: string) => Promise<void>;
  onNewCustomer: () => void;
}

export function CustomerPhone({ phone, bubbles, typing, ready, notice, draft, onDraftChange, onSend, onNewCustomer }: Props) {
  const thread = useStickToBottom<HTMLOListElement>([bubbles.length, typing]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onDraftChange('');
    void onSend(text);
  }

  return (
    <div className="phone">
      <div className="phone-header">
        <div>
          <h2>Customer phone</h2>
          <span className="phone-number">{phone} → Dave's Lawn Desk</span>
        </div>
        <button type="button" onClick={onNewCustomer}>
          New customer
        </button>
      </div>
      <ol className="thread" aria-label="Conversation" ref={thread}>
        {bubbles.map((bubble) => (
          <li key={bubble.id} className={`bubble ${bubble.from}${bubble.failed ? ' failed' : ''}`}>
            {bubble.text}
            {bubble.failed && <span className="not-delivered">Not delivered</span>}
          </li>
        ))}
        {typing && <li className="bubble desk typing">typing…</li>}
      </ol>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form className="composer" onSubmit={onSubmit}>
        <input
          aria-label="Message"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={ready ? 'Text message' : 'Loading…'}
          disabled={!ready}
        />
        {/* Disabled only while loading: a disabled default button blocks Enter. */}
        <button type="submit" disabled={!ready}>
          Send
        </button>
      </form>
    </div>
  );
}
