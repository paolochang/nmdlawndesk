// Dave's calendar (build-plan §6, §7): the visitor's store snapshot from
// `GET /api/calendar/<visitorId>`, turned into FullCalendar events and the
// window the week view may show.
import { GROUP_TINTS, INK, NEW_BOOKING_COLOR, townGroup, type DaveConfig } from './config.ts';

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
  /** Fill colour; `contrastColor` is the text on it. */
  color: string;
  contrastColor: string;
  className?: string;
  /** `bookingId` only on the desk's bookings. */
  extendedProps: { name: string; town: string; basis: string; bookingId?: string };
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

/**
 * The weeks the calendar may show: the Monday after the demo date to the end of
 * the default search window, stretched to the latest booking (the desk can search
 * from a later date when a customer asks for one).
 */
export function calendarWindow(config: DaveConfig, bookings: readonly CalendarBooking[]): CalendarWindow {
  const weekday = new Date(`${config.demoDate}T00:00:00Z`).getUTCDay();
  let end = addDays(config.demoDate, config.searchDays + 1);
  for (const booking of bookings) {
    const after = addDays(booking.start.slice(0, 10), 1);
    if (after > end) end = after;
  }
  return {
    start: addDays(config.demoDate, (8 - weekday) % 7 || 7),
    end,
    slotMinTime: config.hours.open,
    slotMaxTime: config.hours.close,
  };
}

/** What a weekday column says under its date: its towns, or that Dave does not work. */
export function dayLabel(config: DaveConfig, weekday: number): { towns: string; group: number | undefined } {
  const group = config.townGroups.findIndex((g) => g.weekdays.includes(weekday));
  if (group < 0) return { towns: 'No work', group: undefined };
  return { towns: config.townGroups[group].towns.join(' · '), group };
}

/** Seed bookings come with the preset (`seed-…` ids); every other booking was made by the desk. */
const isSeed = (booking: CalendarBooking) => booking.id.startsWith('seed-');

/**
 * One event per booking: seed bookings tinted by their town's weekday group, the
 * desk's bookings in green. `landingId` gets the landing animation.
 */
export function toEvents(bookings: readonly CalendarBooking[], config: DaveConfig, landingId?: string): CalendarEvent[] {
  return bookings.map((booking) => {
    const group = townGroup(config, booking.town) ?? 0;
    const event: CalendarEvent = {
      id: booking.id,
      title: `${booking.name} · ${booking.town}`,
      start: booking.start,
      end: booking.end,
      color: isSeed(booking) ? GROUP_TINTS[group % GROUP_TINTS.length] : NEW_BOOKING_COLOR,
      contrastColor: isSeed(booking) ? INK : '#ffffff',
      extendedProps: { name: booking.name, town: booking.town, basis: booking.basis },
    };
    // The store's id for a booking the desk made (Dave's reference); seed bookings have none to show.
    if (!isSeed(booking)) event.extendedProps.bookingId = booking.id;
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
