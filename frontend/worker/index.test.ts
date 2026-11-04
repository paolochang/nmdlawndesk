import { describe, expect, it, vi } from 'vitest';
import worker from './index.ts';

type FetchMock = ReturnType<typeof vi.fn<(request: Request) => Promise<Response>>>;

function envWith(apiFetch: FetchMock): Env {
	return { API: { fetch: apiFetch } } as unknown as Env;
}

function call(request: Request, env: Env): Promise<Response> {
	return Promise.resolve(worker.fetch(request as Parameters<typeof worker.fetch>[0], env));
}

describe('frontend worker /api proxy', () => {
	it('forwards /api/* to the backend binding with the original URL, method, headers, and body', async () => {
		const apiFetch: FetchMock = vi.fn(async () => Response.json({ streamUrl: 'x' }, { status: 202 }));
		const request = new Request('https://web.example/api/agents/lawn-desk/c1', {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: 'Bearer visitor-token' },
			body: JSON.stringify({ kind: 'user', body: 'hi' }),
		});

		const response = await call(request, envWith(apiFetch));

		expect(response.status).toBe(202);
		expect(apiFetch).toHaveBeenCalledOnce();
		const forwarded = apiFetch.mock.calls[0][0];
		expect(forwarded.url).toBe('https://web.example/api/agents/lawn-desk/c1');
		expect(forwarded.method).toBe('POST');
		// The auth middleware (build-plan §8) reads the Bearer token on the backend.
		expect(forwarded.headers.get('authorization')).toBe('Bearer visitor-token');
		expect(forwarded.headers.get('content-type')).toBe('application/json');
		expect(await forwarded.json()).toEqual({ kind: 'user', body: 'hi' });
	});

	it('streams the backend body instead of buffering it', async () => {
		const encoder = new TextEncoder();
		let closeUpstream!: () => void;
		const upstream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode('data: first\n\n'));
				closeUpstream = () => controller.close();
			},
		});
		const apiFetch: FetchMock = vi.fn(
			async () => new Response(upstream, { headers: { 'content-type': 'text/event-stream' } }),
		);

		const response = await call(
			new Request('https://web.example/api/agents/lawn-desk/c1?live=sse'),
			envWith(apiFetch),
		);

		// The first event must be readable while the backend stream is still open.
		const reader = response.body!.getReader();
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toBe('data: first\n\n');
		expect(response.headers.get('content-type')).toBe('text/event-stream');
		closeUpstream();
		expect((await reader.read()).done).toBe(true);
	});

	it('does not forward paths outside /api', async () => {
		const apiFetch: FetchMock = vi.fn();

		const response = await call(new Request('https://web.example/apiary'), envWith(apiFetch));

		expect(response.status).toBe(404);
		expect(apiFetch).not.toHaveBeenCalled();
	});
});
