# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/app.ts` — the route map; every route is mounted here explicitly.
- `src/cloudflare.ts` — Worker-level exports and non-HTTP handlers.
- `wrangler.jsonc` — Worker config; every agent needs a Durable Object migration entry.

## Commands

- `npm run dev`, then the curl example in `src/app.ts` — talk to the agent locally. (`npx flue run` does not work here: it runs in Node, where the Workers AI `cloudflare` provider does not exist.)
- `npm run dev` — start the dev server.
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
