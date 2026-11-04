import { useState, type FormEvent } from 'react';
import { signIn, statusOf } from './lib/api.ts';
import { signInErrorMessage, type Session } from './lib/session.ts';

interface Props {
  nickname: string;
  expired: boolean;
  onSignedIn: (nickname: string, session: Session) => void;
}

export function SignIn({ nickname: savedNickname, expired, onSignedIn }: Props) {
  const [accessCode, setAccessCode] = useState('');
  const [nickname, setNickname] = useState(savedNickname);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessCode || !nickname.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      onSignedIn(nickname.trim(), await signIn(fetch, accessCode, nickname.trim()));
    } catch (caught) {
      setError(signInErrorMessage(statusOf(caught)));
      setBusy(false);
    }
  }

  return (
    <main className="sign-in">
      <h1>Dave's Lawn Desk</h1>
      <p>A text-message booking agent for Dave's one-person lawn-mowing business.</p>
      {expired && (
        <p className="notice" role="status">
          Your session expired. Sign in again to pick up where you left off.
        </p>
      )}
      <form onSubmit={onSubmit}>
        <label>
          Access code
          <input
            type="password"
            autoComplete="off"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            required
          />
        </label>
        <label>
          AX School nickname
          <input
            autoComplete="username"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
