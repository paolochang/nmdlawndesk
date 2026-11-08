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

// The price table and the town days, straight from /config.
function RulesCard({ config }: { config: DaveConfig }) {
  return (
    <div className="card rules">
      <div className="card-top">
        <h3>Prices and towns</h3>
        <span className="hint">
          {clock(config.hours.open)}–{clock(config.hours.close)}, {money(config.hourlyRateCents)}/hour
        </span>
      </div>
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
      <ul className="town-days">
        {townDays(config).map((group) => (
          <li key={group.days}>
            <i style={{ background: group.color }} aria-hidden="true" />
            <b>{group.days}</b> {group.towns}
          </li>
        ))}
      </ul>
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
    <div className="phone dave-phone">
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
}

export function DavePanel({ config, bookings, landingId, daveBubbles, daveTyping }: Props) {
  if (!config || !bookings) return <p className="placeholder dave-placeholder">Loading Dave's calendar…</p>;
  return (
    <div className="dave-body">
      <DaveCalendar config={config} bookings={bookings} landingId={landingId} />
      <div className="dave-side">
        <DavePhone bubbles={daveBubbles} typing={daveTyping} />
        <RulesCard config={config} />
      </div>
    </div>
  );
}
