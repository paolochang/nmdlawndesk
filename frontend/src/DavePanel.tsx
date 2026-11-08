import FullCalendar, { type CalendarRef } from '@fullcalendar/react';
import classicThemePlugin from '@fullcalendar/react/themes/classic';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/theme.css';
import '@fullcalendar/react/themes/classic/palette.css';
import { useEffect, useMemo, useRef } from 'react';
import { calendarWindow, toEvents, type CalendarBooking } from './lib/calendar.ts';
import { clock, money, priceRows, townDays, type DaveConfig } from './lib/config.ts';
import type { Bubble } from './lib/transcript.ts';
import { useStickToBottom } from './useStickToBottom.ts';

interface CalendarProps {
  config: DaveConfig;
  bookings: readonly CalendarBooking[];
  /** The booking that just landed: the calendar moves to its week and animates it. */
  landingId: string | undefined;
}

// Dave's week (build-plan §7): Mon-Fri, opening hours only, within the weeks the
// desk can book into.
function DaveCalendar({ config, bookings, landingId }: CalendarProps) {
  const calendar = useRef<CalendarRef>(null);
  const range = useMemo(() => calendarWindow(config), [config]);
  const events = useMemo(() => toEvents(bookings, config, landingId), [bookings, config, landingId]);
  const landingStart = bookings.find((booking) => booking.id === landingId)?.start;

  useEffect(() => {
    if (landingStart) calendar.current?.getApi().gotoDate(landingStart.slice(0, 10));
  }, [landingStart]);

  return (
    <div className="dave-calendar">
      <FullCalendar
        ref={calendar}
        plugins={[timeGridPlugin, classicThemePlugin]}
        initialView="timeGridWeek"
        initialDate={range.start}
        validRange={{ start: range.start, end: range.end }}
        firstDay={1}
        weekends={false}
        allDaySlot={false}
        slotMinTime={range.slotMinTime}
        slotMaxTime={range.slotMaxTime}
        expandRows
        height="100%"
        nowIndicator={false}
        headerToolbar={{ start: 'title', end: 'prev,next' }}
        dayHeaderFormat={{ weekday: 'short', month: 'numeric', day: 'numeric' }}
        eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
        events={events}
        eventDidMount={(info) => {
          info.el.title = String(info.event.extendedProps.basis ?? info.event.title);
        }}
      />
    </div>
  );
}

// Work hours and town days, then the price table, straight from /config.
function RulesTables({ config }: { config: DaveConfig }) {
  const hours = `${clock(config.hours.open)}–${clock(config.hours.close)}`;
  return (
    <div className="rules">
      <table>
        <caption>Work hours and towns</caption>
        <thead>
          <tr>
            <th scope="col">Days</th>
            <th scope="col">Towns</th>
            <th scope="col">Hours</th>
          </tr>
        </thead>
        <tbody>
          {townDays(config).map((group) => (
            <tr key={group.days}>
              <td>
                <i style={{ background: group.color }} aria-hidden="true" />
                {group.days}
              </td>
              <td>{group.towns}</td>
              <td>{hours}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <caption>Prices ({money(config.hourlyRateCents)}/hour)</caption>
        <thead>
          <tr>
            <th scope="col">Yard</th>
            <th scope="col">Time</th>
            <th scope="col">Price</th>
          </tr>
        </thead>
        <tbody>
          {priceRows(config).map((row) => (
            <tr key={row.yard}>
              <td>{row.yard}</td>
              <td>{row.duration}</td>
              <td>{row.price}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Other towns are handed to Dave. The final price may change on site.</p>
    </div>
  );
}

interface PhoneProps {
  bubbles: readonly Bubble[];
  typing: boolean;
}

// Dave's own phone: read-only, the desk texts him handoff alerts (build-plan §4).
function DavePhone({ bubbles, typing }: PhoneProps) {
  const thread = useStickToBottom<HTMLOListElement>([bubbles.length, typing]);
  return (
    <div className="phone dave-phone" id="dave-phone">
      <div className="phone-screen">
        <div className="thread-head">
          <div className="avatar" aria-hidden="true">
            L
          </div>
          <b>Lawn Desk assistant</b>
          <small>Texts to Dave</small>
        </div>
        <ol className="thread" aria-label="Dave's texts" ref={thread}>
          {bubbles.length === 0 && !typing && (
            <li className="empty-thread">When the desk hands a customer to Dave, the alert arrives here.</li>
          )}
          {bubbles.map((bubble) => (
            <li key={bubble.id} className="bubble desk">
              {bubble.text}
            </li>
          ))}
          {typing && (
            <li className="bubble desk typing" aria-label="typing…">
              <i />
              <i />
              <i />
            </li>
          )}
        </ol>
        <p className="read-only">Dave answers customers himself.</p>
      </div>
    </div>
  );
}

interface Props {
  config: DaveConfig | undefined;
  bookings: readonly CalendarBooking[] | undefined;
  landingId: string | undefined;
  daveBubbles: readonly Bubble[];
  daveTyping: boolean;
  /** Dave's phone is open over the calendar. */
  daveOpen: boolean;
  /** New texts since the phone was last opened (the button's badge). */
  daveUnread: number;
  onToggleDave: () => void;
}

export function DavePanel({ config, bookings, landingId, daveBubbles, daveTyping, daveOpen, daveUnread, onToggleDave }: Props) {
  if (!config || !bookings) return <p className="placeholder dave-placeholder">Loading Dave's calendar…</p>;
  const label = daveOpen ? "Hide Dave's phone" : daveUnread ? `Dave's phone, ${daveUnread} new` : "Dave's phone";
  return (
    <>
      <div className="dave-body">
        <DaveCalendar config={config} bookings={bookings} landingId={landingId} />
        <RulesTables config={config} />
      </div>
      {daveOpen && <DavePhone bubbles={daveBubbles} typing={daveTyping} />}
      <button
        type="button"
        className={`phone-fab${daveOpen ? ' open' : ''}`}
        aria-label={label}
        aria-expanded={daveOpen}
        aria-controls="dave-phone"
        title={label}
        onClick={onToggleDave}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {daveOpen ? (
            <path d="M6 6l12 12M18 6 6 18" />
          ) : (
            <path d="M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5ZM10.5 18.5h3" />
          )}
        </svg>
        {!daveOpen && daveUnread > 0 && <span className="badge">{daveUnread}</span>}
      </button>
    </>
  );
}
