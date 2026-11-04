import { useEffect, useRef, useState } from 'react';
import type { Customer } from './lib/persona.ts';
import type { RosterEntry } from './lib/roster.ts';

const STATUS_LABEL = { open: 'Open', booked: 'Booked', 'with-dave': 'With Dave' } as const;

interface Props {
  current: Customer;
  earlier: RosterEntry[];
  onOpen: (customer: Customer) => void;
}

// The customer panel head: who is texting, and a dropdown back to earlier customers.
export function CustomerSwitcher({ current, earlier, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const expanded = open && earlier.length > 0;

  useEffect(() => {
    if (!expanded) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [expanded]);

  return (
    <div className="cust-switch" ref={box} onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}>
      <button
        type="button"
        className="switch-btn"
        aria-haspopup="true"
        aria-expanded={expanded}
        disabled={earlier.length === 0}
        onClick={() => setOpen(!open)}
      >
        <span>
          <b>{current.name}</b> · {current.phone}
          {earlier.length > 0 && ` · ${earlier.length} earlier`}
        </span>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>
      {expanded && (
        <div className="switch-menu">
          <div className="menu-label">Go back to an earlier customer</div>
          <ul>
            {earlier.map((entry) => (
              <li key={entry.customer.phone}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpen(entry.customer);
                  }}
                >
                  <span className="row-top">
                    <b>{entry.customer.name}</b>
                    <span className={`status ${entry.status}`}>{STATUS_LABEL[entry.status]}</span>
                  </span>
                  <small>{entry.detail ?? `${entry.customer.street}, ${entry.customer.town}`}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
