import { useFlueAgent } from '@flue/react';
import { useState, type FormEvent } from 'react';

// Walking skeleton (M0): one customer conversation with the backend agent,
// reached through the /api proxy. The real simulator UI replaces this in PR 6.
export default function App() {
  const [conversationId] = useState(() => `m0-${crypto.randomUUID()}`);
  const [draft, setDraft] = useState('');
  const { messages, status, sendMessage } = useFlueAgent({
    url: `/api/agents/lawn-desk/${conversationId}`,
    live: 'sse',
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await sendMessage(text);
  }

  return (
    <main className="phone">
      <h1>Dave's Lawn Desk</h1>
      <ol className="thread" aria-label="Conversation">
        {messages.map((message) => (
          <li key={message.id} className={`bubble ${message.role}`}>
            {message.parts.map((part, index) =>
              part.type === 'text' ? <p key={index}>{part.text}</p> : null,
            )}
          </li>
        ))}
      </ol>
      <p className="status" role="status">
        {status === 'submitted' || status === 'streaming' ? 'typing…' : status === 'error' ? 'error' : ''}
      </p>
      <form onSubmit={onSubmit}>
        <input
          aria-label="Message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Text Dave's Lawn Desk"
        />
        <button type="submit">Send</button>
      </form>
    </main>
  );
}
