import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { mapStacked } from './lib/town-map.ts';
import { ALL_TOWNS, formatPhone, YARDS, type Customer } from './lib/persona.ts';

const YARD_LABEL: Record<string, string> = {
  '0.25': '¼ acre',
  '0.5': '½ acre',
  '0.75': '¾ acre',
  '1': '1 acre',
  '1.5': '1.5 acres',
  '2': '2 acres',
  null: 'Not sure',
};

interface Props {
  customer: Customer;
  /** Locked once the customer has texted, so the card matches what the desk was told. */
  locked: boolean;
  onChange: (patch: Partial<Pick<Customer, 'street' | 'town' | 'acres'>>) => void;
  onNewCustomer: () => void;
  /** The town map, beside the address fields; `stacked` when it wraps under them. */
  map?: (stacked: boolean) => ReactNode;
}

// Who the tester is texting as. The desk only knows what is texted to it.
export function CustomerCard({ customer, locked, onChange, onNewCustomer, map }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const stacked = useStacked(body);
  return (
    <div className="card">
      <div className="card-top">
        <span className="eyebrow">You're texting as</span>
        <button type="button" onClick={onNewCustomer}>
          New customer
        </button>
      </div>
      <div className="persona-body" ref={body}>
        <div className="persona-info">
          <div>
            <div className="persona-name">{customer.name}</div>
            <div className="persona-phone">{formatPhone(customer.phone)}</div>
          </div>
          <div className="fields">
            <label htmlFor="customer-street">Street</label>
            <input
              id="customer-street"
              value={customer.street}
              maxLength={80}
              disabled={locked}
              onChange={(event) => onChange({ street: event.target.value })}
            />
            <label htmlFor="customer-town">Town</label>
            <select id="customer-town" value={customer.town} disabled={locked} onChange={(event) => onChange({ town: event.target.value })}>
              {ALL_TOWNS.map((town) => (
                <option key={town}>{town}</option>
              ))}
            </select>
            <label htmlFor="customer-yard">Yard</label>
            <select
              id="customer-yard"
              value={String(customer.acres)}
              disabled={locked}
              onChange={(event) => onChange({ acres: event.target.value === 'null' ? null : Number(event.target.value) })}
            >
              {YARDS.map((acres) => (
                <option key={String(acres)} value={String(acres)}>
                  {YARD_LABEL[String(acres)]}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">
            {locked ? (
              <>
                <span className="lock">
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <rect x="2" y="5.5" width="8" height="5.5" rx="1.2" />
                    <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
                  </svg>
                  Locked after the first text.
                </span>
                <br />
                Start a New customer to try other details.
              </>
            ) : (
              "Change the address or yard before your first text to try another case. Dave's desk only knows what you text it."
            )}
          </p>
        </div>
        {map?.(stacked)}
      </div>
    </div>
  );
}

/** Whether the card body is too narrow to put the map beside the details. */
function useStacked(body: RefObject<HTMLDivElement | null>): boolean {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setStacked(mapStacked(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [body]);
  return stacked;
}
