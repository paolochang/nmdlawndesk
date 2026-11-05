// Serves the SPA (static assets) and forwards /api/* to the backend Worker
// through the API service binding. The request goes through unchanged so the
// backend sees the browser-facing URL, and the response body is returned
// without being read so agent streams reach the browser as they are written.
export default {
	fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname.startsWith('/api/')) {
			return env.API.fetch(request);
		}
		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
