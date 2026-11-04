// Sign-in state (build-plan §8). The nickname is kept in localStorage only to
// prefill the form; the token lives in sessionStorage for this tab and is
// dropped once it expires. The access code is never stored.

export interface Session {
  visitorId: string;
  token: string;
  /** Seconds since the epoch, as `POST /api/auth` returns it. */
  expiresAt: number;
}

export type AuthState =
  | { status: 'signed-out'; nickname: string; expired: boolean }
  | { status: 'signed-in'; nickname: string; session: Session };

export type AuthEvent =
  | { type: 'signed-in'; nickname: string; session: Session }
  /** Any API call answered 401: the token is missing, forged, or expired. */
  | { type: 'unauthorized' };

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const NICKNAME_KEY = 'lawn-desk.nickname';
export const SESSION_KEY = 'lawn-desk.session';

export function authReducer(state: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case 'signed-in':
      return { status: 'signed-in', nickname: event.nickname, session: event.session };
    case 'unauthorized':
      return state.status === 'signed-in' ? { status: 'signed-out', nickname: state.nickname, expired: true } : state;
  }
}

function parseSession(raw: string | null): Session | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    const { visitorId, token, expiresAt } = value as Record<string, unknown>;
    if (typeof visitorId !== 'string' || typeof token !== 'string' || typeof expiresAt !== 'number') return undefined;
    return { visitorId, token, expiresAt };
  } catch {
    return undefined;
  }
}

/** Restores the tab's session if its token has not expired; otherwise signed out with the nickname prefilled. */
export function loadAuth(local: KeyValueStorage, tab: KeyValueStorage, nowMs: number): AuthState {
  const nickname = local.getItem(NICKNAME_KEY) ?? '';
  const session = parseSession(tab.getItem(SESSION_KEY));
  if (session && nowMs < session.expiresAt * 1000) return { status: 'signed-in', nickname, session };
  tab.removeItem(SESSION_KEY);
  return { status: 'signed-out', nickname, expired: false };
}

/** Writes the state back: nickname to localStorage, session to the tab (or removes it). */
export function saveAuth(state: AuthState, local: KeyValueStorage, tab: KeyValueStorage): void {
  if (state.nickname) local.setItem(NICKNAME_KEY, state.nickname);
  if (state.status === 'signed-in') tab.setItem(SESSION_KEY, JSON.stringify(state.session));
  else tab.removeItem(SESSION_KEY);
}

/** The sign-in error to show. A 401 never says whether the code or the nickname was wrong. */
export function signInErrorMessage(status: number | undefined): string {
  if (status === 401) return 'Sign-in failed. Check the access code or nickname and try again.';
  if (status === 429) return 'Too many tries. Please slow down and try again in a few minutes.';
  return 'Something went wrong. Please try again.';
}

export type SendFailure = 'sign-in-again' | 'new-generation' | 'slow-down' | 'not-sent';

/** What the customer phone does when sending a text fails with this HTTP status. */
export function sendFailure(status: number | undefined): SendFailure {
  if (status === 401) return 'sign-in-again';
  if (status === 409) return 'new-generation';
  if (status === 429) return 'slow-down';
  return 'not-sent';
}

export interface FailedSendView {
  notice?: 'slow-down' | 'not-sent';
  /** Put the text back into the composer. */
  restoreDraft: boolean;
}

/**
 * What the phone shows after a text finally fails (not 409, which recovers).
 * Only the customer who typed it gets the notice and the text back: after New
 * customer, restoring it would send the old customer's text from the new phone.
 */
export function failedSendView(status: number | undefined, sameCustomer: boolean): FailedSendView {
  const failure = sendFailure(status);
  if (failure === 'sign-in-again' || !sameCustomer) return { restoreDraft: false };
  return { notice: failure === 'slow-down' ? 'slow-down' : 'not-sent', restoreDraft: true };
}
