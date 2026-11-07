# Dave's Lawn Desk — backend

Cloudflare Worker `dave-lawn-desk-api`. It runs the Flue agent that answers customer
texts, holds Dave's business rules, and keeps a booking calendar per visitor. It has no
public URL (`workers_dev: false`):
the frontend Worker reaches it through a service binding and forwards every `/api/*`
request unchanged.

At this point the agent is still a placeholder: the rules in `src/domain/` and the
booking store in `src/store/` are not connected to it yet, so it does not know Dave's
prices or schedule. Later PRs add sign-in and the agent tools, and extend this README
with each.

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

Look at Dave's rules and a visitor's calendar. Any id made of letters, digits, `_`,
or `-` works for now; each id gets its own calendar, starting from one of four seed
schedules:

```sh
curl http://localhost:8787/api/config              # hours, town weekdays, prices, demo date
curl http://localhost:8787/api/calendar/my-test    # generation, preset, customers, bookings
curl -X POST http://localhost:8787/api/calendar/my-test/reset   # next generation, a different preset
```

Start this server before the frontend one. Both want the Workers debugger port 9229;
if the frontend gets it first, this server stops with
`EADDRINUSE: address already in use 127.0.0.1:9229`.

## Routes

All routes are under `/api` (`src/app.ts`). None needs a token yet; sign-in comes in
a later PR, so do not deploy these routes publicly before then.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Liveness check |
| `GET /api/config` | Dave's rules (`src/domain/rules.ts`): hours, town weekdays, prices, demo date |
| `GET /api/calendar/<visitorId>` | The visitor's generation, seed preset, customers, and bookings |
| `POST /api/calendar/<visitorId>/reset` | New generation, no customers, a different seed preset |
| `/api/agents/lawn-desk/<id>` | A conversation with the Flue agent `LawnDesk` |

`<visitorId>` must match `[A-Za-z0-9_-]{1,64}`, or the route answers 400. Each visitor's
calendar lives in its own `VisitorStore` Durable Object (`visitor-<visitorId>`), which
rejects overlapping or rule-breaking bookings.

## Scripts

| Command | What it does |
| --- | --- |
| `npm test` | Vitest suite for the domain rules and the booking store (`vitest.config.ts`, kept apart from the Cloudflare Vite plugin) |
| `npm run check:types` | TypeScript type check |
| `npm run build` | Production build into `dist/` |
| `npm run deploy` | Build and deploy the Worker |

## Layout

```
src/
├─ app.ts         route map
├─ cloudflare.ts  Worker exports (VisitorStore Durable Object)
├─ env.d.ts       binding types
├─ agents/        LawnDesk agent (placeholder)
├─ domain/        Dave's rules, quote, slot finding, seed presets (pure, no I/O)
└─ store/         per-visitor booking calendar: ledger logic, Durable Object, routes
test/
├─ domain/        tests for src/domain
└─ store/         ledger and route tests (Node, in-memory fakes)
```
