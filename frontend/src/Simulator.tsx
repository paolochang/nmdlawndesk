import { useFlueAgent } from '@flue/react';
import { createFlueClient } from '@flue/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CustomerCard } from './CustomerCard.tsx';
import { CustomerPhone } from './CustomerPhone.tsx';
import { CustomerSwitcher } from './CustomerSwitcher.tsx';
import { JudgmentLog } from './JudgmentLog.tsx';
import { BookingStatusCard, SuggestedReplies } from './SidePanels.tsx';
import { fetchGeneration, reportingUnauthorized, statusOf } from './lib/api.ts';
import { customerConversationUrl } from './lib/conversation.ts';
import { panelLayout, type Focus } from './lib/layout.ts';
import { CUSTOMER_KEY, newCustomer, restoreCustomer, type Customer } from './lib/persona.ts';
import { recoverStaleSend } from './lib/recover.ts';
import { earlierCustomers, loadRoster, rememberCustomer, rememberRecovered, ROSTER_KEY, type RosterEntry } from './lib/roster.ts';
import { failedSendView, sendFailure, type Session } from './lib/session.ts';
import { bookingStatus, settledStatus, type BookingStatus } from './lib/status.ts';
import { conversationStage, repliesNow } from './lib/suggestions.ts';
import { isTyping, replyFailed, toBubbles, toJudgmentLog } from './lib/transcript.ts';

const LOAD_FAILED = "Could not load Dave's calendar. Reload the page to try again.";
const NOT_SENT = 'Text not sent. Please try again.';
const SLOW_DOWN = 'Slow down a little: too many texts in a short time. Try again in a few minutes.';
const RESET = "Dave's calendar was reset, so this is a new conversation.";
const NO_REPLY = "Dave's desk couldn't reply. Please send your text again.";

interface Props {
  nickname: string;
  session: Session;
  onUnauthorized: () => void;
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

export function Simulator({ nickname, session, onUnauthorized }: Props) {
  // Every request reports a 401, so an expired token anywhere returns to sign-in.
  const authFetch = useMemo(
    () => reportingUnauthorized((input, init) => fetch(input, init), onUnauthorized),
    [onUnauthorized],
  );
  const [generation, setGeneration] = useState<number>();
  const [customer, setCustomer] = useState(() => restoreCustomer(sessionStorage.getItem(CUSTOMER_KEY)));
  useEffect(() => sessionStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer)), [customer]);
  const [roster, setRoster] = useState(() => loadRoster(sessionStorage.getItem(ROSTER_KEY)));
  useEffect(() => sessionStorage.setItem(ROSTER_KEY, JSON.stringify(roster)), [roster]);
  const phone = customer.phone;
  // The phone on screen right now, read by sends that finish after the customer changed.
  const currentPhone = useRef(phone);
  const [focus, setFocus] = useState<Focus>('customer');
  const [notice, setNotice] = useState<string>();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let current = true;
    fetchGeneration(authFetch, session).then(
      (loaded) => {
        if (current) setGeneration(loaded);
      },
      (caught: unknown) => {
        if (current && statusOf(caught) !== 401) setNotice(LOAD_FAILED);
      },
    );
    return () => {
      current = false;
    };
  }, [authFetch, session]);

  const url = generation === undefined ? undefined : customerConversationUrl(session.visitorId, generation, phone);
  const client = useMemo(
    () => (url ? createFlueClient({ url, token: session.token, fetch: authFetch }) : undefined),
    [url, session.token, authFetch],
  );
  const agent = useFlueAgent({ client });
  const { sendMessage, failedSends } = agent;

  const bubbles = useMemo(
    () => toBubbles(agent.messages, failedSends.map((failed) => failed.id)),
    [agent.messages, failedSends],
  );
  const log = useMemo(() => toJudgmentLog(agent.messages), [agent.messages]);
  const status = useMemo(() => bookingStatus(agent.messages), [agent.messages]);
  const stage = useMemo(() => conversationStage(agent.messages), [agent.messages]);
  const typing = isTyping(agent.status);
  const ready = client !== undefined;
  const earlier = generation === undefined ? [] : earlierCustomers(roster, generation, phone);
  // The card locks once this customer has texted in this generation.
  const texted =
    bubbles.some((bubble) => bubble.from === 'customer') ||
    roster.some((entry) => entry.customer.phone === phone && entry.generation === generation);

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
    if (texted && generation !== undefined) setRoster((old) => rememberCustomer(old, rosterEntry(customer, generation, status)));
    currentPhone.current = next.phone;
    setCustomer(next);
    setDraft('');
    setNotice(undefined);
  }

  function onNewCustomer() {
    const taken = [customer, ...roster.map((entry) => entry.customer)];
    switchTo(newCustomer(Math.random, { names: taken.map((c) => c.name), phones: taken.map((c) => c.phone) }));
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
        <div className="who">
          Signed in as <b>{nickname}</b>
        </div>
      </header>
      <main className={`stage focus-${focus}`}>
        <section className={`panel${layout.veiled === 'customer' ? ' veiled' : ''}`} aria-label="Customer">
          <div className="panel-head">
            <h2>Customer</h2>
            <CustomerSwitcher current={customer} earlier={earlier} onOpen={switchTo} />
            {focus !== 'customer' && (
              <button type="button" className="focus-btn" onClick={() => setFocus('customer')}>
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
                    onNewCustomer={onNewCustomer}
                  />
                  <SuggestedReplies
                    replies={repliesNow(stage, customer, typing)}
                    waiting={typing}
                    disabled={!ready}
                    onPick={(text) => void send(text)}
                  />
                  <BookingStatusCard status={settledStatus(agent.messages, typing)} />
                </div>
              </div>
            </div>
            {layout.veiled === 'customer' && (
              <div className="veil">
                <div className="veil-card">
                  <b>Customer side is hidden</b>
                  <p>You're looking at Dave's side. Show both sides to keep texting.</p>
                  <div className="row">
                    <button type="button" className="primary" onClick={() => setFocus('both')}>
                      Show both sides
                    </button>
                    <button type="button" onClick={() => setFocus('customer')}>
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
            <button key={key} type="button" aria-pressed={focus === key} title={title} onClick={() => setFocus(key)}>
              <SwitchIcon focus={key} />
              {label}
            </button>
          ))}
        </nav>

        <section className={`panel${layout.veiled === 'dave' ? ' veiled' : ''}`} aria-label="Dave">
          <div className="panel-head">
            <h2>Dave</h2>
            {focus !== 'dave' && (
              <button type="button" className="focus-btn" onClick={() => setFocus('dave')}>
                Focus
              </button>
            )}
          </div>
          <div className="panel-main">
            <div className="panel-content" inert={layout.veiled === 'dave'}>
              <p className="placeholder dave-placeholder">Dave's calendar, phone, and price table will appear here.</p>
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
                    <button type="button" className="primary" onClick={() => setFocus('both')}>
                      Show both sides
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
      <JudgmentLog entries={log} />
    </div>
  );
}
