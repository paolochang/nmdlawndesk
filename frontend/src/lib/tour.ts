// Onboarding slides (build-plan §15): what the demo is and where everything is on
// the screen. They open by themselves once per nickname in this browser, after
// sign-in, and **How it works** in the header reopens them anytime.
import type { KeyValueStorage } from './session.ts';

/** Areas of the simulator's schematic a slide can highlight. */
export type TourArea =
  | 'header'
  | 'switcher'
  | 'card'
  | 'phone'
  | 'replies'
  | 'status'
  | 'calendar'
  | 'sync'
  | 'facts'
  | 'dave-phone'
  | 'log';

export interface TourSlide {
  id: string;
  title: string;
  lines: string[];
  /** Highlighted in the schematic; none on the welcome, which shows the whole screen. */
  areas: TourArea[];
}

export const TOUR_SLIDES: readonly TourSlide[] = [
  {
    id: 'welcome',
    title: "Welcome to Dave's Lawn Desk",
    lines: [
      'Dave mows lawns on his own. While he works, an AI desk answers the texts his customers send.',
      "You play the customer, on the left. Text for a price or a time: the desk quotes, books the job on Dave's calendar, and texts Dave, on the right.",
    ],
    areas: [],
  },
  {
    id: 'header',
    title: 'The header',
    lines: [
      "Under your Nomad Coders username, you have your own test environment of Dave's Lawn Desk and calendar. Today is Dave's date, in his time zone.",
      'Reset all gives Dave a new schedule and starts fresh conversations.',
      'Cust. / Both / Dave choose which side you see. A hidden side is blurred, so you only know what that person would.',
    ],
    areas: ['header', 'switcher'],
  },
  {
    id: 'customer-card',
    title: "Who you're texting as",
    lines: [
      'The customer card gives you a name, phone, address, and yard size, with the town on the map.',
      'Change the address or yard before your first text to try another case; the card locks after it. New customer starts over as someone else.',
    ],
    areas: ['card'],
  },
  {
    id: 'texting',
    title: 'Text the desk',
    lines: [
      'Type in the phone like a real customer, or click a suggested reply to send it.',
      'The desk only knows what you text it.',
    ],
    areas: ['phone', 'replies'],
  },
  {
    id: 'booking-status',
    title: 'Booking status',
    lines: ["What the desk's texts told this customer: the booked time, place, and price, or that Dave will contact them."],
    areas: ['status'],
  },
  {
    id: 'dave-calendar',
    title: "Dave's calendar",
    lines: [
      "Dave's next two weeks. When the desk books a job, both sides open and the booking lands in its slot.",
      'Sync copies these two weeks into a new calendar in your own Google account; Disconnect removes it.',
    ],
    areas: ['calendar', 'sync'],
  },
  {
    id: 'town-days-prices',
    title: 'Town days and prices',
    lines: [
      'Which towns Dave mows on which weekdays, and what each yard size costs. The desk follows these rules.',
      'A customer learns them only by texting.',
    ],
    areas: ['facts'],
  },
  {
    id: 'dave-phone',
    title: "Dave's phone",
    lines: [
      'The phone button opens the texts the desk sends Dave when it books a job or hands a customer to him. A badge counts new ones.',
    ],
    areas: ['dave-phone'],
  },
  {
    id: 'judgment-log',
    title: 'Judgment log',
    lines: [
      "Docked at the bottom: the desk's tool calls and reasoning for the conversation on screen, so you can see why it answered as it did.",
      'Click its head to open it, and drag its top edge to resize it.',
      'How it works, beside the title, brings these slides back anytime.',
    ],
    areas: ['log'],
  },
];

export const TOUR_KEY = 'lawn-desk.tour';

/**
 * Whether the slides open by themselves when the simulator opens for this visitor:
 * not once this browser has marked them seen, and never on a return from Google,
 * where the outcome popup must stay visible.
 */
export function tourOpensItself(storage: KeyValueStorage, visitorId: string, googleReturned: boolean): boolean {
  if (googleReturned) return false;
  try {
    return storage.getItem(`${TOUR_KEY}:${visitorId}`) === null;
  } catch {
    // Storage blocked: without a way to remember, the slides would open on every load.
    return false;
  }
}

/** Any close (the last slide, Skip, Esc) marks the slides seen for this visitor. */
export function markTourSeen(storage: KeyValueStorage, visitorId: string): void {
  try {
    storage.setItem(`${TOUR_KEY}:${visitorId}`, 'seen');
  } catch {
    // A per-viewer convenience: while storage refuses writes, the slides open on every load.
  }
}
