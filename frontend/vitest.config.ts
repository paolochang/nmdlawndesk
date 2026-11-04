import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts: the Cloudflare plugin starts its own dev
// server, which clashes with Vitest. Worker tests run in Node with a fake binding;
// src tests cover the simulator's pure UI logic (no DOM).
export default defineConfig({
	test: { include: ['worker/**/*.test.ts', 'src/**/*.test.ts'] },
});
