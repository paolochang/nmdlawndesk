// What the desk's text actually told the customer (build-plan §13). The customer's
// side shows a booking detail or offers a time only once the desk's text stated
// it; tool results never reach the customer by themselves.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Whether `text` states the day and start time of `start` (`YYYY-MM-DDTHH:mm`). */
export function statesTime(text: string, start: string): boolean {
  const [date, time = ''] = start.split('T');
  const [, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (!month || !day || Number.isNaN(hour)) return false;
  const lower = text.toLowerCase();
  const name = MONTHS[month - 1];
  const monthWord = `(?:${name}|${name.slice(0, 3)})\\.?`;
  const dated = new RegExp(
    `\\b${monthWord}\\s+${day}(?:st|nd|rd|th)?\\b|\\b${day}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthWord}|\\b${month}/${day}\\b`,
  ).test(lower);
  const h12 = ((hour + 11) % 12) + 1;
  const minutes = String(minute).padStart(2, '0');
  // `8 AM`, `8:00`, `8-9 AM`, `8 to 9`; a start on the half hour needs its minutes.
  const timed = minute
    ? new RegExp(`(?<![\\d:])${h12}:${minutes}\\b`).test(lower)
    : new RegExp(`(?<![\\d:])${h12}(?::00)?\\s*(?:a\\.?m\\b|p\\.?m\\b|-|–|to\\b|o'clock)|(?<![\\d:])${h12}:00\\b`).test(lower);
  return dated && timed;
}

/** Street types either side may write either way (`Rd` / `Road`). */
const STREET_TYPES = new Set(['rd', 'road', 'st', 'street', 'ave', 'av', 'avenue', 'ln', 'lane', 'dr', 'drive', 'ct', 'court', 'way', 'pl', 'place', 'blvd', 'boulevard']);
const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Whether `text` states the street address (every word but its street type). */
export function statesStreet(text: string, address: string): boolean {
  const wanted = words(address).filter((word) => !STREET_TYPES.has(word));
  const said = new Set(words(text));
  return wanted.length > 0 && wanted.every((word) => said.has(word));
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
