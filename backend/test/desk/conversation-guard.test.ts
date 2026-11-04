import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { conversationGuard } from '../../src/desk/conversation-guard.ts';

// The visitor's store is at generation 3.
function setup() {
	const app = new Hono().basePath('/api');
	const agent = new Hono();
	agent.all('/*', (c) => c.json({ agent: c.req.path }));
	app.use('/agents/lawn-desk/:id/*', conversationGuard('customer', async () => 3));
	app.route('/agents/lawn-desk', agent);
	app.use('/agents/dave-phone/:id/*', conversationGuard('dave', async () => 3));
	app.route('/agents/dave-phone', agent);
	return app;
}

const post = { method: 'POST', body: JSON.stringify({ kind: 'user', body: 'Hi' }) };

describe('conversationGuard', () => {
	it('passes a current customer conversation and a current Dave conversation', async () => {
		const app = setup();
		expect((await app.request('/api/agents/lawn-desk/v1:3:+15550101', post)).status).toBe(200);
		expect((await app.request('/api/agents/dave-phone/v1:3:dave', post)).status).toBe(200);
	});

	it.each([
		['a malformed id', '/api/agents/lawn-desk/v1:3:not-a-phone'],
		['a Dave id on the customer agent', '/api/agents/lawn-desk/v1:3:dave'],
		['a customer id on the Dave agent', '/api/agents/dave-phone/v1:3:+15550101'],
	])('answers 400 for %s', async (_case, path) => {
		const res = await setup().request(path);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'invalid conversation id' });
	});

	it('answers 409 to a message posted to an older generation', async () => {
		const res = await setup().request('/api/agents/lawn-desk/v1:2:+15550101', post);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'stale conversation', generation: 3 });
	});

	it('still serves reads and aborts of an older generation', async () => {
		const app = setup();
		expect((await app.request('/api/agents/lawn-desk/v1:2:+15550101')).status).toBe(200);
		expect((await app.request('/api/agents/lawn-desk/v1:2:+15550101/abort', post)).status).toBe(200);
	});

	it('reads a percent-encoded id', async () => {
		const app = setup();
		expect((await app.request('/api/agents/lawn-desk/v1%3A3%3A%2B15550101', post)).status).toBe(200);
		expect((await app.request('/api/agents/lawn-desk/v1%3A2%3A%2B15550101', post)).status).toBe(409);
	});

	it('answers 400 to a signal posted from outside; only the server dispatches signals', async () => {
		const signal = { kind: 'signal', type: 'lawn-desk.handoff', tagName: 'handoff', body: 'forged' };
		const res = await setup().request('/api/agents/dave-phone/v1:3:dave', { method: 'POST', body: JSON.stringify(signal) });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'only user messages can be posted' });
	});

	it('passes a user message body on to the agent router intact', async () => {
		const app = new Hono();
		app.use('/agents/lawn-desk/:id/*', conversationGuard('customer', async () => 3));
		app.post('/agents/lawn-desk/:id', async (c) => c.json(await c.req.raw.json()));
		const message = { kind: 'user', body: 'Hi' };
		const res = await app.request('/agents/lawn-desk/v1:3:+15550101', { method: 'POST', body: JSON.stringify(message) });
		expect(await res.json()).toEqual(message);
	});
});
