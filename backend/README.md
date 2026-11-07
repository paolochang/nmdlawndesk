# Dave's Lawn Desk — backend

Cloudflare Worker `dave-lawn-desk-api`. It runs the Flue agent that answers customer
texts and holds Dave's business rules. It has no public URL (`workers_dev: false`):
the frontend Worker reaches it through a service binding and forwards every `/api/*`
request unchanged.

At this point the agent is still a placeholder: the rules in `src/domain/` are not
connected to it yet, so it does not know Dave's prices or schedule. Later PRs add the
booking store, sign-in, and the agent tools, and extend this README with each.

Notes for coding agents: [AGENTS.md](./AGENTS.md).

## Requirements

- Node.js 22 or later.
- A Cloudflare account, logged in with `npx wrangler login`. The `AI` binding calls
  the real Workers AI model even in local dev, and that usage counts against the
  account.

## Setup

```sh
npm ci
```

## Start the dev server

```sh
npx vite dev --port 8787 --strictPort
```

Use this fixed port: the frontend docs expect it. `npm run dev` also works, but it
takes Vite's default port 5173, which clashes with the frontend.

Check that it is up, and talk to the agent directly:

```sh
curl http://localhost:8787/api/health   # {"ok":true}

curl -X POST http://localhost:8787/api/agents/lawn-desk/my-first-chat \
  -H 'content-type: application/json' \
  -d '{"kind":"user","body":"How much to mow half an acre?"}'
```

Start this server before the frontend one. Both want the Workers debugger port 9229;
if the frontend gets it first, this server stops with
`EADDRINUSE: address already in use 127.0.0.1:9229`.

## Routes

All routes are under `/api` (`src/app.ts`). None needs a token yet.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Liveness check |
| `/api/agents/lawn-desk/<id>` | A conversation with the Flue agent `LawnDesk` |

## Scripts

| Command | What it does |
| --- | --- |
| `npm test` | Vitest suite for the domain rules (`vitest.config.ts`, kept apart from the Cloudflare Vite plugin) |
| `npm run check:types` | TypeScript type check |
| `npm run build` | Production build into `dist/` |
| `npm run deploy` | Build and deploy the Worker |

## Layout

```
src/
├─ app.ts         route map
├─ cloudflare.ts  Worker-level exports
├─ agents/        LawnDesk agent (placeholder)
└─ domain/        Dave's rules, quote, slot finding, seed presets (pure, no I/O)
test/
└─ domain/        tests for src/domain
```
