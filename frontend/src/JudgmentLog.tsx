import { useMemo, useState } from 'react';
import { useStickToBottom } from './useStickToBottom.ts';
import { clockTime, jsonLines, jsonTokens, withPrevious } from './lib/log-format.ts';
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

// Always visible: the agent's tool calls and reasoning for the customer conversation.
export function JudgmentLog({ entries }: { entries: JudgmentEntry[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const linked = useMemo(() => withPrevious(entries), [entries]);
  const shown = linked.filter((entry) => filter === 'all' || entry.kind === filter);
  const tools = entries.filter((entry) => entry.kind === 'tool').length;
  const list = useStickToBottom<HTMLOListElement>([entries, filter]);

  return (
    <footer className="judgment-log">
      <div className="log-head">
        <h2>Judgment log</h2>
        <span className="count">
          {tools} tool call{tools === 1 ? '' : 's'} · {entries.length - tools} reasoning
        </span>
        <div className="seg" role="group" aria-label="Show">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="log-cols" aria-hidden="true">
        <span>Time</span>
        <span>Kind</span>
        <span>Name</span>
        <span>State</span>
        <span>Detail</span>
      </div>
      {entries.length === 0 && <p className="placeholder">Tool calls and reasoning appear here as the agent works.</p>}
      {/* Always mounted, so the stick-to-bottom scroll listener stays attached. */}
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
    </footer>
  );
}
