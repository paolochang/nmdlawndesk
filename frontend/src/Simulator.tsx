import { useFlueAgent } from '@flue/react';
import { createFlueClient } from '@flue/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CustomerPhone } from './CustomerPhone.tsx';
import { JudgmentLog } from './JudgmentLog.tsx';
import { fetchGeneration, reportingUnauthorized, statusOf } from './lib/api.ts';
import { customerConversationUrl, newCustomerPhone, PHONE_KEY, restoreCustomerPhone } from './lib/conversation.ts';
import { recoverStaleSend } from './lib/recover.ts';
import { failedSendView, sendFailure, type Session } from './lib/session.ts';
import { isTyping, replyFailed, toBubbles, toJudgmentLog } from './lib/transcript.ts';

type Panel = 'customer' | 'dave';

const LOAD_FAILED = "Could not load Dave's calendar. Reload the page to try again.";
const NOT_SENT = 'Text not sent. Please try again.';
const SLOW_DOWN = 'Slow down a little: too many texts in a short time. Try again in a few minutes.';
const RESET = "Dave's calendar was reset, so this is a new conversation.";
const NO_REPLY = "Dave's desk couldn't reply. Please send your text again.";

interface Props {
  session: Session;
  onUnauthorized: () => void;
}

export function Simulator({ session, onUnauthorized }: Props) {
  // Every request reports a 401, so an expired token anywhere returns to sign-in.
  const authFetch = useMemo(
    () => reportingUnauthorized((input, init) => fetch(input, init), onUnauthorized),
    [onUnauthorized],
  );
  const [generation, setGeneration] = useState<number>();
  const [phone, setPhone] = useState(() => restoreCustomerPhone(sessionStorage.getItem(PHONE_KEY)));
  useEffect(() => sessionStorage.setItem(PHONE_KEY, phone), [phone]);
  // The phone on screen right now, read by sends that finish after New customer.
  const currentPhone = useRef(phone);
  const usedPhones = useRef<string[]>([]);
  const [openPanel, setOpenPanel] = useState<Panel>('customer');
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
  const { sendMessage } = agent;

  // A 401 already went back to sign-in (reportingUnauthorized); after New customer
  // the failed text belongs to the previous customer and stays out of the composer.
  const showFailure = useCallback((caught: unknown, text: string, from: string) => {
    const view = failedSendView(statusOf(caught), currentPhone.current === from);
    if (view.notice) setNotice(view.notice === 'slow-down' ? SLOW_DOWN : NOT_SENT);
    if (view.restoreDraft) setDraft((current) => current || text);
  }, []);

  const send = useCallback(
    async (text: string) => {
      setNotice(undefined);
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
        if (currentPhone.current === phone) setNotice(RESET);
        setGeneration((current) => Math.max(current ?? 0, recovery.generation));
      }
    },
    [sendMessage, generation, session, phone, authFetch, showFailure],
  );

  function newCustomer() {
    usedPhones.current.push(phone);
    const next = newCustomerPhone(Math.random, usedPhones.current);
    currentPhone.current = next;
    setPhone(next);
    setDraft('');
    setNotice(undefined);
  }

  const { failedSends } = agent;
  const shownNotice = notice ?? (replyFailed(agent.status, failedSends.length) ? NO_REPLY : undefined);
  const bubbles = useMemo(
    () => toBubbles(agent.messages, failedSends.map((failed) => failed.id)),
    [agent.messages, failedSends],
  );
  const log = useMemo(() => toJudgmentLog(agent.messages), [agent.messages]);

  return (
    <div className="simulator">
      <header className="app-header">
        <h1>Dave's Lawn Desk</h1>
        <span className="subtitle">Text-message booking simulator</span>
      </header>
      <div className="panels">
        {openPanel === 'customer' ? (
          <section className="panel" aria-label="Customer">
            <CustomerPhone
              phone={phone}
              bubbles={bubbles}
              typing={isTyping(agent.status)}
              ready={client !== undefined}
              notice={shownNotice}
              draft={draft}
              onDraftChange={setDraft}
              onSend={send}
              onNewCustomer={newCustomer}
            />
          </section>
        ) : (
          <button type="button" className="strip" onClick={() => setOpenPanel('customer')}>
            Customer
          </button>
        )}
        {openPanel === 'dave' ? (
          <section className="panel" aria-label="Dave">
            <h2>Dave</h2>
            <p className="placeholder">Dave's calendar, phone, and price table will appear here.</p>
          </section>
        ) : (
          <button type="button" className="strip" onClick={() => setOpenPanel('dave')}>
            Dave
          </button>
        )}
      </div>
      <JudgmentLog entries={log} />
    </div>
  );
}
