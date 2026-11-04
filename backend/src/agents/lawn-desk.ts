'use agent';
import { useModel } from '@flue/runtime';

// Walking-skeleton version of Dave's booking agent. Tools, rules, and the real
// system prompt arrive in later PRs (build-plan §5).
export function LawnDesk() {
	useModel('cloudflare/@cf/zai-org/glm-4.7-flash');
	return "You answer text messages for Dave's Lawn Desk, a one-person lawn-mowing business. Keep replies short, like an SMS.";
}
