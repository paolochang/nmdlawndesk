// Dave's calendar (build-plan §6, §7): the visitor's store snapshot from
// `GET /api/calendar/<visitorId>`, turned into FullCalendar events and the
// window the week view may show.
import { townColor, type DaveConfig } from './config.ts';

export interface CalendarBooking {
  id: string;
  name: string;
  address: string;
  town: string;
  /** Local wall-clock `YYYY-MM-DDTHH:mm`; `end` is exclusive. */
  start: string;
  end: string;
  durationMinutes: number;
  priceCents: number;
  basis: string;
}

export interface CalendarSnapshot {
  generation: number;
  presetId: string;
  customers: { phone: string; name?: string }[];
  bookings: CalendarBooking[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  color: string;
  className?: string;
  extendedProps: { basis: string };
}

export interface CalendarWindow {
  /** First day shown, `YYYY-MM-DD` (the Monday after the demo date). */
  start: string;
  /** Exclusive end, `YYYY-MM-DD` (the demo date plus the search window). */
  end: string;
  slotMinTime: string;
  slotMaxTime: string;
}

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** The weeks slot search can book into: Monday after the demo date to the end of the search window. */
export function calendarWindow(config: DaveConfig): CalendarWindow {
  const weekday = new Date(`${config.demoDate}T00:00:00Z`).getUTCDay();
  return {
    start: addDays(config.demoDate, (8 - weekday) % 7 || 7),
    end: addDays(config.demoDate, config.searchDays + 1),
    slotMinTime: config.hours.open,
    slotMaxTime: config.hours.close,
  };
}

/** One event per booking, coloured by its town's weekday group; `landingId` gets the landing animation. */
export function toEvents(bookings: readonly CalendarBooking[], config: DaveConfig, landingId?: string): CalendarEvent[] {
  return bookings.map((booking) => {
    const event: CalendarEvent = {
      id: booking.id,
      title: `${booking.name} · ${booking.town}`,
      start: booking.start,
      end: booking.end,
      color: townColor(config, booking.town),
      extendedProps: { basis: booking.basis },
    };
    if (booking.id === landingId) event.className = 'landing';
    return event;
  });
}

/**
 * Whether a loaded calendar may replace the one on screen: never one from an older
 * generation, so a load that started before Reset all cannot undo it.
 */
export function acceptSnapshot(current: CalendarSnapshot | undefined, incoming: CalendarSnapshot): boolean {
  return current === undefined || incoming.generation >= current.generation;
}
