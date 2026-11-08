import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useStickToBottom } from './useStickToBottom.ts';
import { clockTime, jsonLines, jsonTokens, withPrevious } from './lib/log-format.ts';
import { clampLogHeight, LOG_DOCK_KEY, loadLogDock, type LogDock } from './lib/log-dock.ts';
import { unreadCount } from './lib/reveal.ts';
import type { JudgmentEntry } from './lib/transcript.ts';

const STATE_LABEL = { 'input-available': 'RUNNING', 'output-available': 'DONE', 'output-error': 'ERROR' } as const;
type Filter = 'all' | 'tool' | 'reasoning';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['tool', 'Tool calls'],
  ['reasoning', 'Reasoning'],
];

/** Pretty JSON; lines new since the previous call of the same tool are green with a `+`. */
function Json({ value, previous }: { value: unknown; previous?: unknown }) {
  const { lines } = jsonLines(value, previous);
  return (
    <pre>
      {lines.map((line, index) => (
        <span key={index} className={`ln${line.added ? ' add' : ''}`}>
          {jsonTokens(line.text).map((token, at) =>
            token.kind === 'plain' ? token.text : (
              <span key={at} className={`j-${token.kind}`}>
                {token.text}
              </span>
            ),
          )}
        </span>
      ))}
    </pre>
  );
}

function newSince(value: unknown, previous: unknown, label: string) {
  const { added } = jsonLines(value, previous);
  return added > 0 ? <span className="delta">+{added} new since the last {label}</span> : null;
}

const RESIZE_STEP_PX = 24;

function readDock(): LogDock {
  try {
    return loadLogDock(localStorage.getItem(LOG_DOCK_KEY));
  } catch {
    return loadLogDock(null);
  }
}

// The agent's tool calls and reasoning for the customer conversation, docked at the
// bottom like browser dev tools: collapsed to its head by default (with a count of
// entries that arrived while collapsed), opened to a height the tester can drag.
interface Props {
  entries: JudgmentEntry[];
  /** The customer conversation on screen; its loaded history is not counted as new. */
  conversation: string | undefined;
  historyReady: boolean;
}

export function JudgmentLog({ entries, conversation, historyReady }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [dock, setDock] = useState(readDock);
  useEffect(() => {
    try {
      localStorage.setItem(LOG_DOCK_KEY, JSON.stringify(dock));
    } catch {
      // Storage blocked: the log still works, it just starts collapsed next time.
    }
  }, [dock]);
  const linked = useMemo(() => withPrevious(entries), [entries]);
  const shown = linked.filter((entry) => filter === 'all' || entry.kind === filter);
  const tools = entries.filter((entry) => entry.kind === 'tool').length;
  const list = useStickToBottom<HTMLOListElement>([entries, filter, dock.open]);
  const log = useRef<HTMLElement>(null);

  // Entries seen per conversation: its history once loaded, then everything shown while open.
  const [seen, setSeen] = useState<{ conversation: string; count: number }>();
  const seenCount = seen && seen.conversation === conversation ? seen.count : undefined;
  if (conversation && historyReady && seenCount === undefined) {
    setSeen({ conversation, count: entries.length });
  } else if (conversation && dock.open && seenCount !== undefined && seenCount !== entries.length) {
    setSeen({ conversation, count: entries.length });
  }
  const fresh = dock.open ? 0 : unreadCount(entries.length, seenCount);

  const resizeTo = (height: number) => setDock((old) => ({ ...old, height: clampLogHeight(height, window.innerHeight) }));
  const onResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const startY = event.clientY;
    const startHeight = log.current?.getBoundingClientRect().height ?? dock.height;
    handle.setPointerCapture(event.pointerId);
    const move = (moved: globalThis.PointerEvent) => resizeTo(startHeight + startY - moved.clientY);
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };
  const onResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    resizeTo(dock.height + (event.key === 'ArrowUp' ? RESIZE_STEP_PX : -RESIZE_STEP_PX));
  };

  return (
    <footer ref={log} className={`judgment-log${dock.open ? ' open' : ''}`} style={dock.open ? { height: dock.height } : undefined}>
      {dock.open && (
        <div
          className="log-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the judgment log"
          aria-valuenow={dock.height}
          tabIndex={0}
          onPointerDown={onResizeStart}
          onKeyDown={onResizeKey}
        />
      )}
      <div className="log-head">
        <h2>
          <button
            type="button"
            className="log-toggle"
            aria-expanded={dock.open}
            aria-controls="judgment-log-body"
            onClick={() => setDock((old) => ({ ...old, open: !old.open }))}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 10l4-4 4 4" />
            </svg>
            Judgment log
          </button>
        </h2>
        <span className="count">
          {tools} tool call{tools === 1 ? '' : 's'} · {entries.length - tools} reasoning
        </span>
        {fresh > 0 && <span className="log-new">{fresh} new</span>}
        {dock.open && (
          <div className="seg" role="group" aria-label="Show">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Hidden, not unmounted, while collapsed: the stick-to-bottom scroll listener stays attached. */}
      <div id="judgment-log-body" className="log-body" hidden={!dock.open}>
        <div className="log-cols" aria-hidden="true">
          <span>Time</span>
          <span>Kind</span>
          <span>Name</span>
          <span>State</span>
          <span>Detail</span>
        </div>
        {entries.length === 0 && <p className="placeholder">Tool calls and reasoning appear here as the agent works.</p>}
        <ol ref={list}>
          {shown.map((entry) => (
            <li key={entry.id} className="log-row">
              <time>{clockTime(entry.time)}</time>
              {entry.kind === 'tool' ? (
                <>
                  <span className="kind tool">tool call</span>
                  <span className="tool-name">{entry.toolName}</span>
                  <span className={`state ${entry.state}`}>{STATE_LABEL[entry.state]}</span>
                  <div className="io">
                    <div>
                      <div className="io-cap">input {entry.previous && newSince(entry.input, entry.previous.input, 'input')}</div>
                      <Json value={entry.input} previous={entry.previous?.input} />
                    </div>
                    <span className="arrow" aria-hidden="true">
                      →
                    </span>
                    <div>
                      <div className="io-cap">
                        output{' '}
                        {entry.state === 'output-available' &&
                          entry.previous?.output !== undefined &&
                          newSince(entry.output, entry.previous.output, 'output')}
                      </div>
                      {entry.state === 'output-available' && <Json value={entry.output} previous={entry.previous?.output} />}
                      {entry.state === 'output-error' && <pre className="error-text">{entry.errorText}</pre>}
                      {entry.state === 'input-available' && <pre className="pending">running…</pre>}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <span className="kind reasoning">reasoning</span>
                  <span className="tool-name">—</span>
                  <span />
                  <p className="thought">{entry.text}</p>
                </>
              )}
            </li>
          ))}
        </ol>
      </div>
    </footer>
  );
}
