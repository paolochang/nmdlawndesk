import { describe, expect, it } from 'vitest';
import {
  authReducer,
  loadAuth,
  NICKNAME_KEY,
  saveAuth,
  sendFailure,
  SESSION_KEY,
  signInErrorMessage,
  type AuthState,
  type KeyValueStorage,
  type Session,
} from './session.ts';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const NOW_MS = 1_800_000_000_000;
const session: Session = { visitorId: 'v123', token: 'payload.sig', expiresAt: NOW_MS / 1000 + 7200 };
const signedIn: AuthState = { status: 'signed-in', nickname: 'test-reviewer', session };

describe('authReducer', () => {
  it('signs in with the session and nickname', () => {
    const state = authReducer({ status: 'signed-out', nickname: '', expired: false }, {
      type: 'signed-in',
      nickname: 'test-reviewer',
      session,
    });
    expect(state).toEqual(signedIn);
  });

  it('goes back to sign-in with the nickname prefilled on a 401', () => {
    expect(authReducer(signedIn, { type: 'unauthorized' })).toEqual({
      status: 'signed-out',
      nickname: 'test-reviewer',
      expired: true,
    });
  });

  it('keeps a signed-out state as it is on a stray 401', () => {
    const out: AuthState = { status: 'signed-out', nickname: 'x', expired: false };
    expect(authReducer(out, { type: 'unauthorized' })).toBe(out);
  });
});

describe('loadAuth / saveAuth', () => {
  it('restores an unexpired session from the tab and the nickname from localStorage', () => {
    const local = memoryStorage({ [NICKNAME_KEY]: 'test-reviewer' });
    const tab = memoryStorage({ [SESSION_KEY]: JSON.stringify(session) });
    expect(loadAuth(local, tab, NOW_MS)).toEqual(signedIn);
  });

  it('drops an expired or malformed session and prefills the nickname', () => {
    const local = memoryStorage({ [NICKNAME_KEY]: 'test-reviewer' });
    const expired = memoryStorage({ [SESSION_KEY]: JSON.stringify({ ...session, expiresAt: NOW_MS / 1000 }) });
    expect(loadAuth(local, expired, NOW_MS)).toEqual({ status: 'signed-out', nickname: 'test-reviewer', expired: false });
    expect(expired.data).toEqual({});

    const broken = memoryStorage({ [SESSION_KEY]: '{not json' });
    expect(loadAuth(memoryStorage(), broken, NOW_MS)).toEqual({ status: 'signed-out', nickname: '', expired: false });
  });

  it('stores the nickname and session when signed in, and only the nickname after a 401', () => {
    const local = memoryStorage();
    const tab = memoryStorage();
    saveAuth(signedIn, local, tab);
    expect(local.data).toEqual({ [NICKNAME_KEY]: 'test-reviewer' });
    expect(JSON.parse(tab.data[SESSION_KEY])).toEqual(session);

    saveAuth(authReducer(signedIn, { type: 'unauthorized' }), local, tab);
    expect(local.data).toEqual({ [NICKNAME_KEY]: 'test-reviewer' });
    expect(tab.data).toEqual({});
  });
});

describe('signInErrorMessage', () => {
  it('does not say which of the access code or nickname was wrong on a 401', () => {
    const message = signInErrorMessage(401);
    expect(message).toMatch(/access code or nickname/i);
    expect(message).not.toMatch(/not (on|in) the (allow)?list|wrong access code/i);
  });

  it('asks the reviewer to slow down on a 429, and falls back to a generic error', () => {
    expect(signInErrorMessage(429)).toMatch(/slow down/i);
    expect(signInErrorMessage(500)).toMatch(/try again/i);
    expect(signInErrorMessage(undefined)).toMatch(/try again/i);
  });
});

describe('sendFailure', () => {
  it('maps a failed send to what the phone does next', () => {
    expect(sendFailure(401)).toBe('sign-in-again');
    expect(sendFailure(409)).toBe('new-generation');
    expect(sendFailure(429)).toBe('slow-down');
    expect(sendFailure(500)).toBe('not-sent');
    expect(sendFailure(undefined)).toBe('not-sent');
  });
});
