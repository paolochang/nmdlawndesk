import { describe, expect, it } from 'vitest';
import { GoogleLink } from '../../src/google/link.ts';
import { VisitorLedger } from '../../src/store/ledger.ts';
import { fakeGoogle, memoryKv } from './fake-google.ts';

const NOW = Date.parse('2026-12-03T15:40:00Z'); // Thu 10:40 in New York; window Dec 3 - Dec 16

async function connected() {
	const google = fakeGoogle();
	const kv = memoryKv();
	const ledger = new VisitorLedger(kv, () => 0, () => NOW);
	const link = new GoogleLink({
		kv,
		fetch: google.fetcher,
		clock: () => NOW,
		secret: 'test-secret',
		client: { clientId: 'client-1', clientSecret: 'shh' },
		calendar: () => ledger.list(),
	});
	await link.connect('good-code', 'http://localhost:5180/api/google/callback');
	const [calendarId] = google.calendars.keys();
	const events = () => [...google.calendars.get(calendarId)!.values()];
	return { google, kv, ledger, link, calendarId, events };
}

const inWindow = (start: string) => start.slice(0, 10) >= '2026-12-03' && start.slice(0, 10) <= '2026-12-16';

describe('Google Calendar sync (build-plan §14)', () => {
	it('inserts one event per booking in the window with Dave’s title, time, and details, and nothing outside it', async () => {
		const { ledger, link, events } = await connected();
		const later = ledger.add({ name: 'Ola Berg', address: '3 Elm St', town: 'Ashford', start: '2026-12-17T08:00', acres: 0.5 });
		expect(later.ok).toBe(true);
		await link.sync();

		const bookings = ledger.list().bookings;
		const wanted = bookings.filter((b) => inWindow(b.start));
		expect(wanted.length).toBeGreaterThan(0);
		expect(bookings.some((b) => !inWindow(b.start))).toBe(true);
		expect(events().map((e) => e.summary).sort()).toEqual(wanted.map((b) => `${b.name} · ${b.town}`).sort());
		const first = wanted[0];
		expect(events().find((e) => e.summary === `${first.name} · ${first.town}`)).toMatchObject({
			description: first.basis,
			start: { dateTime: `${first.start}:00`, timeZone: 'America/New_York' },
			end: { dateTime: `${first.end}:00`, timeZone: 'America/New_York' },
		});
		expect(link.status().lastSync).toBe('ok');
	});

	it('never touches an event it did not insert', async () => {
		const { google, ledger, link, calendarId } = await connected();
		const theirs = { id: 'theirs', summary: 'Dentist', description: '', start: { dateTime: '', timeZone: '' }, end: { dateTime: '', timeZone: '' } };
		google.calendars.get(calendarId)!.set('theirs', theirs);
		await link.sync();
		ledger.reset();
		link.moveWindow('2026-12-03');
		await link.sync();
		await link.disconnect();
		expect(google.requests.filter((r) => r.endsWith('/theirs'))).toEqual([]);
	});

	it('a desk booking adds its event; with Google failing the booking and Dave’s text stand and the sync reports failed', async () => {
		const { google, ledger, link, events } = await connected();
		await link.sync();
		const before = events().length;

		const generation = ledger.list().generation;
		ledger.addCustomerText('+15550101', 'Hi, I am Mia Park at 6 Heath Road, Ashford, half an acre', generation);
		google.state.failCalendar = true;
		const booked = ledger.add({ name: 'Mia Park', address: '6 Heath Rd', town: 'Ashford', start: '2026-12-14T08:00', acres: 0.5, generation, phone: '+15550101' });
		expect(booked.ok).toBe(true);
		await link.sync();
		expect(link.status().lastSync).toBe('failed');
		expect(ledger.list().daveTexts.at(-1)?.id).toBe(booked.ok ? booked.booking.id : '');

		google.state.failCalendar = false;
		await link.sync();
		expect(link.status().lastSync).toBe('ok');
		expect(events().length).toBe(before + 1);
		expect(events().some((e) => e.summary === 'Mia Park · Ashford')).toBe(true);
	});

	it('Reset all deletes the old generation’s events, moves the window, and syncs the new bookings', async () => {
		const { ledger, link, events } = await connected();
		await link.sync();
		const oldIds = events().map((e) => e.id);

		const next = ledger.reset();
		link.moveWindow(next.today);
		await link.sync();

		expect(events().some((e) => oldIds.includes(e.id))).toBe(false);
		const wanted = next.bookings.filter((b) => inWindow(b.start));
		expect(events().map((e) => e.summary).sort()).toEqual(wanted.map((b) => `${b.name} · ${b.town}`).sort());
		expect(link.status().connected).toBe(true);
	});

	it('Disconnect deletes the calendar, revokes the grant, and forgets the link', async () => {
		const { google, kv, link } = await connected();
		await link.sync();

		expect(await link.disconnect()).toEqual({ calendarRemoved: true });
		expect(google.calendars.size).toBe(0);
		expect(google.state.revoked).toBe(true);
		expect(kv.map.has('google')).toBe(false);
		expect(link.status()).toEqual({ connected: false });
	});

	it('a revoked grant found during a sync counts as disconnected', async () => {
		const google = fakeGoogle();
		const kv = memoryKv();
		const ledger = new VisitorLedger(kv, () => 0, () => NOW);
		let now = NOW;
		const link = new GoogleLink({ kv, fetch: google.fetcher, clock: () => now, secret: 's', client: { clientId: 'c', clientSecret: 'x' }, calendar: () => ledger.list() });
		await link.connect('good-code', 'http://localhost:5180/api/google/callback');
		google.state.revoked = true;
		now += 2 * 60 * 60 * 1000; // the access token from connect has expired
		await link.sync();
		expect(link.status()).toEqual({ connected: false });
	});

	it('a Reset all during a running sync keeps the moved window (review round 1)', async () => {
		const { ledger, link } = await connected();
		const running = link.sync();
		ledger.reset();
		link.moveWindow('2026-12-05');
		await running;
		expect(link.status().window).toEqual({ from: '2026-12-05', to: '2026-12-18' });
	});

	it('a sync started during Disconnect does not bring the link back (review round 1)', async () => {
		const { google, kv, link } = await connected();
		const disconnecting = link.disconnect();
		const late = link.sync();
		await Promise.all([disconnecting, late]);
		expect(kv.map.has('google')).toBe(false);
		expect(link.status()).toEqual({ connected: false });
		expect(google.calendars.size).toBe(0);
	});

	it('connecting again replaces the old calendar without revoking the new grant (review round 1)', async () => {
		const { google, link } = await connected();
		await link.sync();
		await link.connect('good-code', 'http://localhost:5180/api/google/callback');
		await link.sync();
		expect(google.state.revoked).toBe(false);
		expect(google.calendars.size).toBe(1);
		expect(link.status()).toMatchObject({ connected: true, lastSync: 'ok' });
	});
});
