import { defineConfig } from '@flue/runtime/config';

export default defineConfig({
	target: 'cloudflare',
	// Ship only the Workers AI binding provider (build-plan §2 LLM decision).
	// Add a provider ID here before using a model from another provider.
	providers: ['cloudflare'],
});
