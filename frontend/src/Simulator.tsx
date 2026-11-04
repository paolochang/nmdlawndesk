import { useFlueAgent } from '@flue/react';
import { createFlueClient } from '@flue/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CustomerPhone } from './CustomerPhone.tsx';
import { JudgmentLog } from './JudgmentLog.tsx';
import { fetchGeneration, reportingUnauthorized, statusOf } from './lib/api.ts';
import { customerConversationUrl, newCustomerPhone, PHONE_KEY, restoreCustomerPhone } from './lib/conversation.ts';
import { sendFailure, type Session } from './lib/session.ts';
import { isTyping, toBubbles, toJudgmentLog } from './lib/transcript.ts';

type Panel = 'customer' | 'dave';

const LOAD_FAILED = "Could not load Dave's calendar. Reload the page to try again.";
const NOT_SENT = 'Text not sent. Please try again.';

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
  const usedPhones = useRef<string[]>([]);
  const [openPanel, setOpenPanel] = useState<Panel>('customer');
  const [notice, setNotice] = useState<string>();
  const [draft, setDraft] = useState('');
  // A text refused with 409 (stale generation), re-sent once the new conversation's client is ready.
  const resend = useRef<string>(undefined);

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

  const send = useCallback(
    async (text: string, clearNotice = true) => {
      if (clearNotice) setNotice(undefined);
      try {
        await sendMessage(text);
      } catch (caught) {
        switch (sendFailure(statusOf(caught))) {
          case 'sign-in-again':
            return; // reportingUnauthorized already went back to sign-in
          case 'new-generation': {
            const latest = await fetchGeneration(authFetch, session).catch(() => undefined);
            if (latest === undefined || latest === generation) {
              setNotice(NOT_SENT);
              return;
            }
            setNotice("Dave's calendar was reset, so this is a new conversation.");
            resend.current = text;
            setGeneration(latest);
            return;
          }
          case 'slow-down':
            setNotice('Slow down a little: too many texts in a short time. Try again in a few minutes.');
            return;
          case 'not-sent':
            setNotice(NOT_SENT);
        }
      }
    },
    [sendMessage, authFetch, session, generation],
  );

  useEffect(() => {
    const text = resend.current;
    if (text === undefined || !client) return;
    resend.current = undefined;
    void send(text, false); // keep the "calendar was reset" notice
  }, [client, send]);

  function newCustomer() {
    usedPhones.current.push(phone);
    setPhone(newCustomerPhone(Math.random, usedPhones.current));
    setDraft('');
    setNotice(undefined);
  }

  const { failedSends } = agent;
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
              notice={notice}
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
