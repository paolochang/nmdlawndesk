import { type FormEvent } from 'react';
import { useStickToBottom } from './useStickToBottom.ts';
import type { Bubble } from './lib/transcript.ts';

interface Props {
  bubbles: Bubble[];
  typing: boolean;
  ready: boolean;
  notice: string | undefined;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: (text: string) => Promise<void>;
}

// A phone at true proportions (390 × 844), texting Dave's desk.
export function CustomerPhone({ bubbles, typing, ready, notice, draft, onDraftChange, onSend }: Props) {
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
      <div className="phone-screen">
        <div className="thread-head">
          <div className="avatar" aria-hidden="true">
            D
          </div>
          <b>Dave's Lawn Desk</b>
          <small>Text message</small>
        </div>
        <ol className="thread" aria-label="Conversation" ref={thread}>
          {bubbles.length === 0 && !typing && <li className="empty-thread">Text Dave's desk to ask for a price or a time.</li>}
          {bubbles.map((bubble) => (
            <li key={bubble.id} className={`bubble ${bubble.from}${bubble.failed ? ' failed' : ''}`}>
              {bubble.text}
              {bubble.failed && <span className="not-delivered">Not delivered</span>}
            </li>
          ))}
          {typing && (
            <li className="bubble desk typing" aria-label="typing…">
              <i />
              <i />
              <i />
            </li>
          )}
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
          <button type="submit" className="send" aria-label="Send" disabled={!ready}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
