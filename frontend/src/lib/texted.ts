// What the desk's text actually told the customer (build-plan §13). The customer's
// side shows a booking detail or offers a time only once the desk's text stated
// it; tool results never reach the customer by themselves.

/** A hyphen or dash of any kind: models write ranges with `-`, `‑` (U+2011), `–`, or `—`. */
const DASH = '[-\\u2010-\\u2015\\u2212]';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_WORD = `(${MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join('|')})\\.?`;
const ORDINAL = '(?:st|nd|rd|th)?';

interface DateMention {
  at: number;
  end: number;
  month: number;
  day: number;
}

interface Clock {
  hour: number;
  minute: number;
  /** `am`/`pm` when the text says it (for a range start, taken from the range end). */
  meridiem?: 'am' | 'pm';
}

interface TimeMention {
  at: number;
  end: number;
  start: Clock;
  /** The end of a range, `9:00` in `8:00-9:00 AM`. */
  until?: Clock;
}

function dateMentions(text: string): DateMention[] {
  const found: DateMention[] = [];
  const monthOf = (word: string) => MONTHS.findIndex((m) => m === word || m.slice(0, 3) === word) + 1;
  const patterns: [RegExp, (m: RegExpExecArray) => [number, number]][] = [
    [new RegExp(`\\b${MONTH_WORD}\\s+(\\d{1,2})${ORDINAL}\\b`, 'g'), (m) => [monthOf(m[1]), Number(m[2])]],
    [new RegExp(`\\b(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH_WORD}`, 'g'), (m) => [monthOf(m[2]), Number(m[1])]],
    [/\b(\d{1,2})\/(\d{1,2})\b/g, (m) => [Number(m[1]), Number(m[2])]],
  ];
  for (const [pattern, read] of patterns) {
    for (const m of text.matchAll(pattern)) {
      const [month, day] = read(m as RegExpExecArray);
      found.push({ at: m.index, end: m.index + m[0].length, month, day });
    }
  }
  return found;
}

const MERIDIEM = '(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)';
const TIME = new RegExp(
  `(?<![\\d:.$/])(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}?(?:\\s*(?:${DASH}|to)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}?)?(?![\\d/])`,
  'g',
);
const meridiemOf = (word: string | undefined) => (word ? (word.startsWith('a') ? 'am' : 'pm') : undefined);
const to24 = ({ hour, meridiem }: Clock) => (meridiem === 'pm' ? (hour % 12) + 12 : hour % 12);

/** Clock times: a number counts only with minutes or AM/PM on it or on its range. */
function timeMentions(text: string, dates: readonly DateMention[]): TimeMention[] {
  const found: TimeMention[] = [];
  for (const m of text.matchAll(TIME)) {
    const at = m.index;
    const end = at + m[0].trimEnd().length;
    if (dates.some((d) => at < d.end && d.at < end)) continue; // `Nov 16` is a date, not 16 o'clock
    const start: Clock = { hour: Number(m[1]), minute: Number(m[2] ?? 0), meridiem: meridiemOf(m[3]) };
    const until: Clock | undefined = m[4] ? { hour: Number(m[4]), minute: Number(m[5] ?? 0), meridiem: meridiemOf(m[6]) } : undefined;
    if (!(m[2] || m[3] || m[5] || m[6])) continue;
    if (start.hour > 12 || (until && until.hour > 12)) continue;
    if (until && !start.meridiem && until.meridiem) {
      // `8-9 AM`: the start shares the end's AM/PM, unless that would put it after the end (`11:30-12:30 PM`).
      start.meridiem = until.meridiem;
      if (to24(start) * 60 + start.minute > to24(until) * 60 + until.minute) start.meridiem = 'am';
    }
    found.push({ at, end, start, until });
  }
  return found;
}

/** Each time with the date mention nearest to it (ties go to the date before it). */
function pairs(text: string): { date: DateMention; time: TimeMention }[] {
  const lower = text.toLowerCase();
  const dates = dateMentions(lower);
  if (!dates.length) return [];
  return timeMentions(lower, dates).map((time) => {
    const gap = (d: DateMention) => (d.end <= time.at ? time.at - d.end : d.at - time.end + 0.5);
    const date = dates.reduce((best, d) => (gap(d) < gap(best) ? d : best));
    return { date, time };
  });
}

const sameClock = (said: Clock, hour: number, minute: number) =>
  said.minute === minute && (said.meridiem ? to24(said) === hour : said.hour % 12 === hour % 12);

function split(dateTime: string): { month: number; day: number; hour: number; minute: number } {
  const [date, time = ''] = dateTime.split('T');
  const [, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return { month, day, hour, minute };
}

/**
 * Whether `text` states `start` (`YYYY-MM-DDTHH:mm`): a clock time equal to its start
 * (AM/PM checked when given) next to its date. A range end is not a start.
 */
export function statesTime(text: string, start: string): boolean {
  const s = split(start);
  return pairs(text).some(
    ({ date, time }) => date.month === s.month && date.day === s.day && sameClock(time.start, s.hour, s.minute),
  );
}

/** Whether `text` states the range `start`-`end`, end included. */
export function statesRange(text: string, start: string, end: string): boolean {
  const s = split(start);
  const e = split(end);
  return pairs(text).some(
    ({ date, time }) =>
      date.month === s.month &&
      date.day === s.day &&
      sameClock(time.start, s.hour, s.minute) &&
      time.until !== undefined &&
      sameClock(time.until, e.hour, e.minute),
  );
}

/**
 * Street types either side may write either way, each mapped to one form. The same
 * list as the backend's grounding (`backend/src/domain/grounding.ts`).
 */
const STREET_TYPES: Record<string, string> = {
  road: 'rd', rd: 'rd', street: 'st', st: 'st', avenue: 'ave', ave: 'ave', av: 'ave', lane: 'ln', ln: 'ln',
  drive: 'dr', dr: 'dr', court: 'ct', ct: 'ct', way: 'way', place: 'pl', pl: 'pl', boulevard: 'blvd', blvd: 'blvd',
  terrace: 'ter', ter: 'ter', circle: 'cir', cir: 'cir', highway: 'hwy', hwy: 'hwy', parkway: 'pkwy', pkwy: 'pkwy',
};
const words = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}.]+/u)
    .map((word) => word.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
    .map((word) => STREET_TYPES[word] ?? word);

/** Whether `text` states the street address: its words in order (`Rd` = `Road`). */
export function statesStreet(text: string, address: string): boolean {
  const wanted = words(address);
  const said = words(text);
  return wanted.length > 0 && said.some((_, i) => wanted.every((word, j) => said[i + j] === word));
}

/** Whether `text` names the town. */
export function statesTown(text: string, town: string): boolean {
  return town.length > 0 && words(text).includes(town.toLowerCase());
}

/** Whether `text` states the price, e.g. `$67.50` (or `$67.5`). */
export function statesPrice(text: string, price: string): boolean {
  if (!price) return false;
  const short = price.replace(/\.(\d)0$/, '.$1').replace(/\.0+$/, '');
  return text.includes(price) || text.includes(short);
}

/** Whether `text` states the job length, e.g. `1 h` as "1 hour" or "1 h". */
export function statesDuration(text: string, duration: string): boolean {
  const hours = duration.replace(/\s*h$/, '');
  if (!hours) return false;
  return new RegExp(`(?<![\\d.])${hours.replace('.', '\\.')}\\s*(?:h\\b|hr|hour)`, 'i').test(text);
}
