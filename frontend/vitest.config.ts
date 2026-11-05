import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts: the Cloudflare plugin starts its own dev
// server, which clashes with Vitest. Worker tests run in Node with a fake binding.
export default defineConfig({
	test: { include: ['worker/**/*.test.ts'] },
});
