import { useStickToBottom } from './useStickToBottom.ts';
import type { JudgmentEntry } from './lib/transcript.ts';

const STATE_LABEL: Record<string, string> = {
  'input-available': 'running',
  'output-available': 'done',
  'output-error': 'error',
};

function json(value: unknown): string {
  return JSON.stringify(value) ?? '';
}

// Always visible: the agent's tool calls and reasoning for the customer conversation.
export function JudgmentLog({ entries }: { entries: JudgmentEntry[] }) {
  const list = useStickToBottom<HTMLOListElement>([entries]);

  return (
    <footer className="judgment-log">
      <h2>Judgment log</h2>
      {entries.length === 0 && (
        <p className="placeholder">Tool calls and reasoning appear here as the agent works.</p>
      )}
      {/* Always mounted, so the stick-to-bottom scroll listener stays attached. */}
      <ol ref={list}>
        {entries.map((entry) =>
          entry.kind === 'tool' ? (
            <li key={entry.id} className={`entry tool ${entry.state}`}>
              <span className="tool-name">{entry.toolName}</span>
              <span className="state">{STATE_LABEL[entry.state]}</span>
              <code>{json(entry.input)}</code>
              {entry.state === 'output-available' && <code className="output">→ {json(entry.output)}</code>}
              {entry.state === 'output-error' && <code className="output">→ {entry.errorText}</code>}
            </li>
          ) : (
            <li key={entry.id} className="entry reasoning">
              <span className="tool-name">reasoning</span>
              <span className="text">{entry.text}</span>
            </li>
          ),
        )}
      </ol>
    </footer>
  );
}
