import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts: the Cloudflare and Flue plugins start their own
// dev server, which clashes with Vitest. Domain tests are pure and run in Node.
export default defineConfig({
	test: { include: ['test/**/*.test.ts'] },
});
