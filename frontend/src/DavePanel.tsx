import FullCalendar, { type CalendarRef } from '@fullcalendar/react';
import classicThemePlugin from '@fullcalendar/react/themes/classic';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/theme.css';
import '@fullcalendar/react/themes/classic/palette.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { calendarWindow, dayLabel, toEvents, type CalendarBooking } from './lib/calendar.ts';
import { hoursNote, priceNote, priceRows, townDays, type DaveConfig } from './lib/config.ts';
import type { Bubble } from './lib/transcript.ts';
import { useStickToBottom } from './useStickToBottom.ts';

interface CalendarProps {
  config: DaveConfig;
  bookings: readonly CalendarBooking[];
  /** The booking that just landed: the calendar moves to its week and animates it. */
  landingId: string | undefined;
}

const GROUP_CLASS = ['group-a', 'group-b'];

/** `2026-11-16` (a Date at local midnight) → `Week of Nov 16`. */
function weekTitle(start: Date | undefined): string {
  if (!start) return '';
  return `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

// Dave's week (build-plan §7): Mon-Fri, opening hours only, within the weeks the
// desk can book into. Each day says which towns Dave mows; Wednesday is off.
function DaveCalendar({ config, bookings, landingId }: CalendarProps) {
  const calendar = useRef<CalendarRef>(null);
  const range = useMemo(() => calendarWindow(config, bookings), [config, bookings]);
  const events = useMemo(() => toEvents(bookings, config, landingId), [bookings, config, landingId]);
  const landingStart = bookings.find((booking) => booking.id === landingId)?.start;
  const [shown, setShown] = useState<{ start: Date; end: Date }>();

  useEffect(() => {
    if (landingStart) calendar.current?.getApi().gotoDate(landingStart.slice(0, 10));
  }, [landingStart]);

  const iso = (date: Date | undefined) =>
    date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
  const atStart = !shown || iso(shown.start) <= range.start;
  const atEnd = !shown || iso(shown.end) >= range.end;

  return (
    <div className="dave-calendar">
      <div className="cal-top">
        <h3>{weekTitle(shown?.start)}</h3>
        <button type="button" aria-label="Previous week" disabled={atStart} onClick={() => calendar.current?.getApi().prev()}>
          ‹
        </button>
        <button type="button" aria-label="Next week" disabled={atEnd} onClick={() => calendar.current?.getApi().next()}>
          ›
        </button>
      </div>
      <div className="cal-body">
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
          slotHeaderFormat={{ hour: 'numeric', meridiem: 'short' }}
          expandRows
          height="100%"
          nowIndicator={false}
          headerToolbar={false}
          datesSet={(info) => setShown({ start: info.start, end: info.end })}
          dayHeaderClass={(info) => {
            const group = dayLabel(config, info.dow).group;
            return group === undefined ? '' : GROUP_CLASS[group % GROUP_CLASS.length];
          }}
          dayHeaderContent={(info) => (
            <div className="day-head">
              <b>
                {info.date.toLocaleDateString('en-US', { weekday: 'short' })} {info.date.getDate()}
              </b>
              <small>{dayLabel(config, info.dow).towns}</small>
            </div>
          )}
          dayLaneClass={(info) => (dayLabel(config, info.dow).group === undefined ? 'day-off' : '')}
          events={events}
          eventContent={(info) => (
            <div className="booking-block">
              <b>{String(info.event.extendedProps.name)}</b>
              <span>
                {info.timeText} · {String(info.event.extendedProps.town)}
              </span>
            </div>
          )}
          eventDidMount={(info) => {
            info.el.title = String(info.event.extendedProps.basis ?? info.event.title);
          }}
        />
      </div>
    </div>
  );
}

// Town days and prices, straight from /config, each with its note.
function RulesTables({ config }: { config: DaveConfig }) {
  return (
    <div className="facts">
      <section className="fact">
        <h3>Town days</h3>
        <table>
          <thead>
            <tr>
              <th scope="col">Days</th>
              <th scope="col">Towns</th>
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
              </tr>
            ))}
          </tbody>
        </table>
        <p>{hoursNote(config)}</p>
      </section>
      <section className="fact">
        <h3>Prices</h3>
        <table>
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
        <p>{priceNote(config)}</p>
      </section>
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
            <li className="empty-thread">When the desk books a job or hands a customer to Dave, the text arrives here.</li>
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
  /** /config or the calendar could not be loaded. */
  failed: boolean;
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

export function DavePanel({ config, failed, bookings, landingId, daveBubbles, daveTyping, daveOpen, daveUnread, onToggleDave }: Props) {
  if (!config || !bookings) {
    return (
      <p className="placeholder dave-placeholder">
        {failed ? "Could not load Dave's side. Reload the page to try again." : "Loading Dave's calendar…"}
      </p>
    );
  }
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
