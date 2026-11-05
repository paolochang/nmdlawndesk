# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity. `LawnDesk` serves customer conversations, `DavePhone` the Dave conversation; both only wire `src/desk/`.
- `src/desk/` — the agent's tools (`deskTools`), prompts, and the conversation-id guard. Plain modules, tested in Node with fakes.
- `src/domain/` — pure business rules (no I/O); `src/store/` — the per-visitor `VisitorStore` Durable Object.
- `src/app.ts` — the route map; every route is mounted here explicitly.
- `src/cloudflare.ts` — Worker-level exports and non-HTTP handlers.
- `wrangler.jsonc` — Worker config; every agent needs a Durable Object migration entry.

## Commands

- `npx vite dev --port 8787 --strictPort` — start the dev server on the port the scripts and docs use (`npm run dev` alone serves Vite's default 5173; pass `BASE_URL` to `scripts/m1.ts` then). The agents need the Durable Object store and the Workers AI binding, so `flue run` (Node-only) cannot load them.
- `ACCESS_CODE=... NICKNAME=... node scripts/m1.ts` — M1 evidence against the dev server: signs in, resets the calendar, books a slot through a scripted conversation, and checks a 2-acre handoff reaches Dave's phone. Then it checks the off-script turns (build-plan §4 "Conversation"): a question after the handoff, a greeting, a price question, and haggling. Use a made-up test nickname in the local allowlist. Calls the real Workers AI model.
- `npm run deploy` — build and deploy the Worker.
- `npm run check:types` — typecheck.
- `npm test` — run the Vitest suite (`vitest.config.ts`, kept apart from the Cloudflare Vite plugin).
- `npx flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `npx flue add` — list blueprints for adding channels, sandboxes, and databases.
- `node scripts/allowlist.ts <nickname-list> > <out.json>` — nickname list → `allowEntry` KV entries (needs `SECRET` in the environment). Load with `npx wrangler kv bulk put --binding ALLOWLIST --local <out.json>` for dev, `--remote` for production. Full steps: `../build-plan.md` §8 "Allowlist operations".

## Auth and local secrets

- Local dev reads `SECRET` and `ACCESS_CODE` from `.dev.vars` (gitignored); copy `.dev.vars.example`. Production uses `npx wrangler secret put`.
- `src/auth/` holds sign-in (`POST /api/auth`) and the 401/403/429 guard; `mountAuth(...)` must stay before every `app.route(...)` in `src/app.ts`.
- Never commit a nickname list or generated allowlist JSON.
