import { useFlueAgent } from '@flue/react';
import { createFlueClient } from '@flue/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CustomerCard } from './CustomerCard.tsx';
import { CustomerPhone } from './CustomerPhone.tsx';
import { CustomerSwitcher } from './CustomerSwitcher.tsx';
import { DavePanel } from './DavePanel.tsx';
import { GoogleSyncButton, GoogleSyncNote } from './GoogleSync.tsx';
import { JudgmentLog } from './JudgmentLog.tsx';
import { BookingStatusCard, SuggestedReplies } from './SidePanels.tsx';
import { TownMap } from './TownMap.tsx';
import {
  fetchCalendar,
  fetchConfig,
  fetchGeneration,
  googleConnect,
  googleDisconnect,
  reportingUnauthorized,
  resetCalendar,
  statusOf,
} from './lib/api.ts';
import { acceptSnapshot, daveTextBubbles, todayLabel, type CalendarSnapshot } from './lib/calendar.ts';
import type { DaveConfig } from './lib/config.ts';
import { googleReturn } from './lib/google.ts';
import { customerConversationUrl } from './lib/conversation.ts';
import { panelLayout, type Focus } from './lib/layout.ts';
import { newCustomer, type Customer } from './lib/persona.ts';
import { recoverStaleSend } from './lib/recover.ts';
import { gatedBubbles, LANDING_MS, PANELS_OPEN_MS, REVEAL_PAUSE_MS, settleReply, unreadCount, type Reveal } from './lib/reveal.ts';
import {
  earlierCustomers,
  loadCustomers,
  rememberCustomer,
  rememberRecovered,
  saveCustomers,
  takenDetails,
  type RosterEntry,
} from './lib/roster.ts';
import { failedSendView, sendFailure, type Session } from './lib/session.ts';
import { bookingStatus, settledStatus, textedStatus, type BookingStatus } from './lib/status.ts';
import { conversationStage, repliesNow } from './lib/suggestions.ts';
import { isTyping, replyFailed, toBubbles, toJudgmentLog } from './lib/transcript.ts';

const LOAD_FAILED = "Could not load Dave's calendar. Reload the page to try again.";
const NOT_SENT = 'Text not sent. Please try again.';
const SLOW_DOWN = 'Slow down a little: too many texts in a short time. Try again in a few minutes.';
const RESET = "Dave's calendar was reset, so this is a new conversation.";
const NO_REPLY = "Dave's desk couldn't reply. Please send your text again.";
const RESET_FAILED = 'Reset did not go through. Please try again.';
// Google Calendar (build-plan §14).
const GOOGLE_POLL_MS = 1500;
const GOOGLE_NOT_SET_UP = 'Google Calendar is not set up on this server.';
const GOOGLE_CONNECT_FAILED = 'Could not open Google. Please try again.';
const GOOGLE_DISCONNECT_FAILED = 'Disconnect did not go through. Please try again.';
const GOOGLE_DISCONNECTED = "Disconnected. The Dave's Lawn Desk calendar and its events were removed from your Google account.";
const GOOGLE_CALENDAR_LEFT =
  "Disconnected, but Google did not remove the Dave's Lawn Desk calendar. You can delete it in Google Calendar.";

interface Props {
  nickname: string;
  session: Session;
  onUnauthorized: () => void;
  onSignOut: () => void;
}

function rosterEntry(customer: Customer, generation: number, status: BookingStatus): RosterEntry {
  if (status.kind === 'booked') return { customer, generation, status: 'booked', detail: status.when };
  return { customer, generation, status: status.kind };
}

// Open sides are drawn white (outlined), veiled sides filled.
function SwitchIcon({ focus }: { focus: Focus }) {
  const [left, right] = focus === 'customer' ? [15, 7] : focus === 'dave' ? [7, 15] : [11, 11];
  return (
    <svg viewBox="0 0 26 18" aria-hidden="true">
      <rect x="1" y="1" width={left} height="16" rx="2" className={focus === 'dave' ? 'veiled' : 'open'} />
      <rect x={3 + left} y="1" width={right} height="16" rx="2" className={focus === 'customer' ? 'veiled' : 'open'} />
    </svg>
  );
}

export function Simulator({ nickname, session, onUnauthorized, onSignOut }: Props) {
  // Every request reports a 401, so an expired token anywhere returns to sign-in.
  const authFetch = useMemo(
    () => reportingUnauthorized((input, init) => fetch(input, init), onUnauthorized),
    [onUnauthorized],
  );
  const [generation, setGeneration] = useState<number>();
  // Kept per visitor in localStorage, so a new tab or a restarted browser reopens them.
  const [saved] = useState(() => loadCustomers(localStorage, session.visitorId));
  const [customer, setCustomer] = useState(saved.customer);
  const [roster, setRoster] = useState(saved.roster);
  useEffect(() => saveCustomers(localStorage, session.visitorId, customer, roster), [session.visitorId, customer, roster]);
  const phone = customer.phone;
  // The phone on screen right now, read by sends that finish after the customer changed.
  const currentPhone = useRef(phone);
  // Back from Google's consent (build-plan §14): open on Dave's side, where the result shows.
  const [googleReturned] = useState(() => googleReturn(window.location.href));
  const [focus, setFocus] = useState<Focus>(googleReturned ? 'dave' : 'customer');
  const [notice, setNotice] = useState<string>();
  const [draft, setDraft] = useState('');

  const [calendar, setCalendar] = useState<CalendarSnapshot>();
  const [config, setConfig] = useState<DaveConfig>();
  // Dave's side could not load (/config or the first calendar); it says so instead of "Loading…".
  const [daveFailed, setDaveFailed] = useState(false);

  useEffect(() => {
    let current = true;
    fetchCalendar(authFetch, session).then(
      (loaded) => {
        if (!current) return;
        setCalendar(loaded);
        setGeneration(loaded.generation);
      },
      (caught: unknown) => {
        if (current && statusOf(caught) !== 401) {
          setNotice(LOAD_FAILED);
          setDaveFailed(true);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [authFetch, session]);

  // /config is public and never changes while the page is open.
  useEffect(() => {
    let current = true;
    fetchConfig((input, init) => fetch(input, init)).then(
      (loaded) => {
        if (current) setConfig(loaded);
      },
      () => {
        if (current) setDaveFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  /** Shows `snapshot` unless the screen already has a newer generation (Reset all won). */
  const showCalendar = useCallback((snapshot: CalendarSnapshot) => {
    setCalendar((current) => (acceptSnapshot(current, snapshot) ? snapshot : current));
  }, []);

  // Dave's calendar is shared by every conversation, so it is reloaded on its own:
  // whenever a reply settles, a conversation opens, or Dave's side is opened.
  const loadCalendar = useCallback(() => {
    fetchCalendar(authFetch, session).then(showCalendar, () => undefined);
  }, [authFetch, session, showCalendar]);

  const [googleMessage, setGoogleMessage] = useState(googleReturned?.message);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleNoticeOpen, setGoogleNoticeOpen] = useState(false);
  useEffect(() => {
    if (googleReturned) window.history.replaceState(null, '', googleReturned.cleaned);
  }, [googleReturned]);
  // While the store copies events into Google, reload until it says it is done; an
  // interval keeps going even when one reload fails.
  const googleSyncing = Boolean(calendar?.google?.syncing);
  useEffect(() => {
    if (!googleSyncing) return;
    const timer = window.setInterval(loadCalendar, GOOGLE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [googleSyncing, loadCalendar]);
  // Back from Google's page through the browser's back button: the page may come back
  // from the back-forward cache with "Opening Google…" still on.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setGoogleBusy(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  async function onGoogleConnect() {
    setGoogleBusy(true);
    setGoogleMessage(undefined);
    try {
      const { url: consent } = await googleConnect(authFetch, session);
      window.location.assign(consent);
    } catch (caught) {
      const status = statusOf(caught);
      if (status !== 401) setGoogleMessage(status === 503 ? GOOGLE_NOT_SET_UP : status === 429 ? SLOW_DOWN : GOOGLE_CONNECT_FAILED);
      setGoogleBusy(false);
      setGoogleNoticeOpen(false);
    }
  }

  async function onGoogleDisconnect() {
    setGoogleBusy(true);
    setGoogleMessage(undefined);
    try {
      const { calendarRemoved } = await googleDisconnect(authFetch, session);
      setGoogleMessage(calendarRemoved ? GOOGLE_DISCONNECTED : GOOGLE_CALENDAR_LEFT);
      loadCalendar();
    } catch (caught) {
      const status = statusOf(caught);
      if (status !== 401) setGoogleMessage(status === 429 ? SLOW_DOWN : GOOGLE_DISCONNECT_FAILED);
    } finally {
      setGoogleBusy(false);
    }
  }

  const url = generation === undefined ? undefined : customerConversationUrl(session.visitorId, generation, phone);
  const client = useMemo(
    () => (url ? createFlueClient({ url, token: session.token, fetch: authFetch }) : undefined),
    [url, session.token, authFetch],
  );
  const agent = useFlueAgent({ client });
  // A conversation opened (New customer, an earlier customer, a new generation).
  useEffect(() => {
    if (url) loadCalendar();
  }, [url, loadCalendar]);
  const { sendMessage, failedSends } = agent;

  // Dave's phone: read-only, the desk's texts to Dave (build-plan §7, §13). They are
  // fixed templates kept by the visitor's store and come with the calendar snapshot.
  const daveKey = generation === undefined ? undefined : `${session.visitorId}:${generation}`;
  const daveLoaded = calendar !== undefined && calendar.generation === generation;
  // A backend from before §13 sends no `daveTexts`.
  const daveBubbles = useMemo(() => daveTextBubbles((daveLoaded && calendar.daveTexts) || []), [daveLoaded, calendar]);
  const [daveOpen, setDaveOpen] = useState(false);
  // How many of Dave's texts the tester has seen, for this generation only.
  const [daveSeen, setDaveSeen] = useState<{ url: string; count: number }>();

  const bubbles = useMemo(
    () => toBubbles(agent.messages, failedSends.map((failed) => failed.id)),
    [agent.messages, failedSends],
  );
  const log = useMemo(() => toJudgmentLog(agent.messages), [agent.messages]);
  const status = useMemo(() => bookingStatus(agent.messages), [agent.messages]);
  const stage = useMemo(() => conversationStage(agent.messages), [agent.messages]);
  const typing = isTyping(agent.status);
  const settled = useMemo(() => settledStatus(agent.messages, typing), [agent.messages, typing]);
  // What the desk's texts told the customer: all the customer's card shows (build-plan §13).
  const shownStatus = useMemo(() => textedStatus(agent.messages, typing), [agent.messages, typing]);
  const ready = client !== undefined;
  const earlier = generation === undefined ? [] : earlierCustomers(roster, generation, phone);
  // The card locks once this customer has texted in this generation.
  const texted =
    bubbles.some((bubble) => bubble.from === 'customer') ||
    roster.some((entry) => entry.customer.phone === phone && entry.generation === generation);

  // The booking reveal (build-plan §7) starts when the desk's reply reaches the
  // customer phone, never from the tool result. While the desk replies, Dave's
  // phone holds new alerts (`daveHeld`) and the status shown stays settled.
  const [landingId, setLandingId] = useState<string>();
  const [daveHeld, setDaveHeld] = useState<number>();
  const replying = useRef<{ url: string | undefined; before: BookingStatus }>(undefined);
  const timers = useRef<number[]>([]);
  // Bumped by Reset all: a reveal from before the reset must not touch the new environment.
  const revealEpoch = useRef(0);
  const cancelReveals = useCallback(() => {
    revealEpoch.current++;
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    setLandingId(undefined);
  }, []);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const startReveal = useCallback(
    (reveal: Reveal) => {
      const epoch = revealEpoch.current;
      const later = (run: () => void, ms: number) => {
        const timer = window.setTimeout(() => {
          timers.current = timers.current.filter((t) => t !== timer);
          if (revealEpoch.current === epoch) run();
        }, ms);
        timers.current.push(timer);
      };
      const loaded = reveal.bookingId ? fetchCalendar(authFetch, session) : undefined;
      later(() => {
        // Open Dave's side; a tester already on Dave's wide side keeps it.
        setFocus((current) => (current === 'customer' ? 'both' : current));
        // A handoff's text to Dave comes with the calendar; a booking's comes at its landing.
        if (!reveal.bookingId) loadCalendar();
      }, REVEAL_PAUSE_MS);
      if (!loaded) return;
      later(() => {
        loaded.then(
          (snapshot) => {
            if (revealEpoch.current !== epoch) return;
            showCalendar(snapshot);
            setLandingId(reveal.bookingId);
            later(() => setLandingId((id) => (id === reveal.bookingId ? undefined : id)), LANDING_MS);
          },
          () => undefined,
        );
      }, REVEAL_PAUSE_MS + PANELS_OPEN_MS);
    },
    [authFetch, session, loadCalendar, showCalendar],
  );

  useEffect(() => {
    if (typing) {
      if (!replying.current) {
        replying.current = { url, before: settled };
        setDaveHeld(daveBubbles.length);
      }
      return;
    }
    const started = replying.current;
    if (!started) return;
    replying.current = undefined;
    setDaveHeld(undefined);
    // Only a reply in the conversation still on screen reveals anything; any
    // settled reply may still have changed the calendar or texted Dave.
    const after = settleReply(started, url, settled);
    if (after.reveal) startReveal(after.reveal);
    if (after.loadCalendar) loadCalendar();
  }, [typing, settled, url, startReveal, loadCalendar, daveBubbles.length]);

  // Dave's phone badge: texts shown since the phone was last opened. History that
  // loads with the conversation counts as seen.
  const shownDave = gatedBubbles(daveBubbles, daveHeld);
  const daveSeenCount = daveSeen && daveSeen.url === daveKey ? daveSeen.count : undefined;
  // Adjusted while rendering (React's pattern for state derived from props), not in an effect.
  // History counts as seen in full, even while a reply holds new texts back.
  if (daveKey && daveLoaded && daveSeenCount === undefined) {
    setDaveSeen({ url: daveKey, count: daveBubbles.length });
  } else if (daveKey && daveOpen && daveSeenCount !== undefined && daveSeenCount < shownDave.length) {
    setDaveSeen({ url: daveKey, count: shownDave.length });
  }

  // A 401 already went back to sign-in (reportingUnauthorized); after the customer
  // changed, the failed text belongs to the previous one and stays out of the composer.
  const showFailure = useCallback((caught: unknown, text: string, from: string) => {
    const view = failedSendView(statusOf(caught), currentPhone.current === from);
    if (view.notice) setNotice(view.notice === 'slow-down' ? SLOW_DOWN : NOT_SENT);
    if (view.restoreDraft) setDraft((current) => current || text);
  }, []);

  const send = useCallback(
    async (text: string) => {
      setNotice(undefined);
      if (generation !== undefined) setRoster((old) => rememberCustomer(old, rosterEntry(customer, generation, status)));
      try {
        await sendMessage(text);
      } catch (caught) {
        if (sendFailure(statusOf(caught)) !== 'new-generation' || generation === undefined) {
          showFailure(caught, text, phone);
          return;
        }
        // 409: the calendar moved to a new generation. Re-send on the phone the
        // text was typed on, then follow the calendar to that generation.
        const recovery = await recoverStaleSend(
          { visitorId: session.visitorId, phone, generation, text },
          {
            fetchGeneration: () => fetchGeneration(authFetch, session),
            sendTo: (to, body) =>
              createFlueClient({ url: to, token: session.token, fetch: authFetch }).send({
                message: { kind: 'user', body },
              }),
          },
        );
        if (!recovery.ok) {
          showFailure(recovery.error, text, phone);
          return;
        }
        setRoster((old) => rememberRecovered(old, customer, recovery.generation));
        if (currentPhone.current === phone) setNotice(RESET);
        setGeneration((current) => Math.max(current ?? 0, recovery.generation));
      }
    },
    [sendMessage, generation, session, phone, customer, status, authFetch, showFailure],
  );

  /** Leaves the current customer (remembered if they texted) for `next`. */
  function switchTo(next: Customer) {
    // A reveal still in its pause belongs to the customer being left. Its calendar
    // load does not: the booking or handoff it would reveal still texted Dave.
    cancelReveals();
    loadCalendar();
    if (texted && generation !== undefined) setRoster((old) => rememberCustomer(old, rosterEntry(customer, generation, status)));
    currentPhone.current = next.phone;
    setCustomer(next);
    setDraft('');
    setNotice(undefined);
  }

  function onNewCustomer(known: { customers: CalendarSnapshot['customers']; bookings: { name: string }[] } | undefined = calendar) {
    switchTo(newCustomer(Math.random, takenDetails(customer, roster, known)));
  }

  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  /** Reset all: a new generation with a different seed preset, and a new customer. */
  async function onReset() {
    setResetting(true);
    try {
      const snapshot = await resetCalendar(authFetch, session);
      cancelReveals();
      showCalendar(snapshot);
      setGeneration(snapshot.generation);
      setDaveOpen(false);
      setFocus('customer');
      onNewCustomer(snapshot);
    } catch (caught) {
      const status = statusOf(caught);
      if (status !== 401) setNotice(status === 429 ? SLOW_DOWN : RESET_FAILED);
    } finally {
      setResetting(false);
      setConfirmingReset(false);
    }
  }

  /** The tester changes the layout; opening Dave's side shows a fresh calendar. */
  function openFocus(next: Focus) {
    setFocus(next);
    // Dave's side is veiled on the customer side, so his phone closes with it.
    if (next === 'customer') setDaveOpen(false);
    if (next !== 'customer') loadCalendar();
  }

  const layout = panelLayout(focus);
  const shownNotice = notice ?? (replyFailed(agent.status, failedSends.length) ? NO_REPLY : undefined);
  const switchButtons: [Focus, string, string][] = [
    ['customer', 'Cust.', 'Customer wide, Dave hidden'],
    ['both', 'Both', 'Both sides at the same width'],
    ['dave', 'Dave', 'Dave wide, customer hidden'],
  ];

  return (
    <div className="simulator">
      <header className="app-header">
        <div className="brand">
          <h1>Dave's Lawn Desk</h1>
          <span className="subtitle">Text-message booking simulator</span>
        </div>
        {calendar && (
          <div className="today">
            Today <b>{todayLabel(calendar.today, calendar.timeZone)}</b>
          </div>
        )}
        <div className="reset">
          {confirmingReset ? (
            <>
              <span>Start over with a new schedule?</span>
              <button type="button" className="danger" disabled={resetting} onClick={() => void onReset()}>
                {resetting ? 'Resetting…' : 'Reset all'}
              </button>
              <button type="button" disabled={resetting} onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={generation === undefined}
              title="New schedule for Dave, fresh conversations"
              onClick={() => setConfirmingReset(true)}
            >
              Reset all
            </button>
          )}
        </div>
        <div className="who">
          <span>
            Signed in as <b>{nickname}</b>
          </span>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className={`stage focus-${focus}`}>
        <section className={`panel${layout.veiled === 'customer' ? ' veiled' : ''}`} aria-label="Customer">
          <div className="panel-head">
            <h2>Customer</h2>
            <CustomerSwitcher current={customer} earlier={earlier} onOpen={switchTo} />
            {focus !== 'customer' && (
              <button type="button" className="focus-btn" onClick={() => openFocus('customer')}>
                Focus
              </button>
            )}
          </div>
          <div className="panel-main">
            <div className="panel-content" inert={layout.veiled === 'customer'}>
              <div className="cust-body">
                <CustomerPhone
                  bubbles={bubbles}
                  typing={typing}
                  ready={ready}
                  notice={shownNotice}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={send}
                />
                <div className="cust-side">
                  <CustomerCard
                    customer={customer}
                    locked={texted}
                    onChange={(patch) => setCustomer((old) => ({ ...old, ...patch }))}
                    onNewCustomer={() => onNewCustomer()}
                    map={<TownMap focus={focus} customer={customer} config={config} />}
                  />
                  <SuggestedReplies
                    replies={repliesNow(stage, customer, typing)}
                    waiting={typing}
                    disabled={!ready}
                    onPick={(text) => void send(text)}
                  />
                  <BookingStatusCard status={shownStatus} />
                </div>
              </div>
            </div>
            {layout.veiled === 'customer' && (
              <div className="veil">
                <div className="veil-card">
                  <b>Customer side is hidden</b>
                  <p>You're looking at Dave's side. Show both sides to keep texting.</p>
                  <div className="row">
                    <button type="button" className="primary" onClick={() => openFocus('both')}>
                      Show both sides
                    </button>
                    <button type="button" onClick={() => openFocus('customer')}>
                      Back to customer
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <nav className="switcher" aria-label="Panel layout">
          {switchButtons.map(([key, label, title]) => (
            <button key={key} type="button" aria-pressed={focus === key} title={title} onClick={() => openFocus(key)}>
              <SwitchIcon focus={key} />
              {label}
            </button>
          ))}
        </nav>

        <section className={`panel${layout.veiled === 'dave' ? ' veiled' : ''}`} aria-label="Dave">
          <div className="panel-head">
            <h2>Dave</h2>
            <GoogleSyncButton
              status={calendar?.google}
              today={calendar?.today}
              busy={googleBusy}
              noticeOpen={googleNoticeOpen}
              onOpenNotice={() => {
                setGoogleMessage(undefined);
                setGoogleNoticeOpen(true);
              }}
              onCloseNotice={() => setGoogleNoticeOpen(false)}
              onConnect={() => void onGoogleConnect()}
              onDisconnect={() => void onGoogleDisconnect()}
            />
            {focus !== 'dave' && (
              <button type="button" className="focus-btn" onClick={() => openFocus('dave')}>
                Focus
              </button>
            )}
          </div>
          <div className="panel-main">
            <div className="panel-content" inert={layout.veiled === 'dave'}>
              <DavePanel
                config={config}
                failed={daveFailed}
                bookings={calendar?.bookings}
                today={calendar?.today}
                landingId={landingId}
                daveBubbles={shownDave}
                daveTyping={false}
                daveOpen={daveOpen}
                daveUnread={unreadCount(shownDave.length, daveSeenCount)}
                calendarNote={<GoogleSyncNote status={calendar?.google} message={googleMessage} />}
                onToggleDave={() => {
                  if (!daveOpen) loadCalendar();
                  setDaveOpen(!daveOpen);
                }}
              />
            </div>
            {layout.veiled === 'dave' && (
              <div className="veil">
                <div className="veil-card">
                  <b>Dave's side is hidden</b>
                  <p>
                    A customer learns prices and open times only by texting. Test the same way, then open Dave's side to
                    check what happened.
                  </p>
                  <div className="row">
                    <button type="button" className="primary" onClick={() => openFocus('both')}>
                      Show both sides
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
      <JudgmentLog entries={log} conversation={url} historyReady={agent.historyReady} />
    </div>
  );
}
