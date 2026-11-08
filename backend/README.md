# Dave's Lawn Desk — backend

Cloudflare Worker `dave-lawn-desk-api`. It runs the Flue agent that answers customer
texts, holds Dave's business rules, keeps a booking calendar per visitor, and signs
reviewers in. It has no public URL (`workers_dev: false`): the frontend Worker reaches
it through a service binding and forwards every `/api/*` request unchanged.

The agent `LawnDesk` answers each customer conversation with tools over Dave's rules
(`src/domain/`) and the visitor's booking calendar (`src/store/`): it quotes a job,
finds open slots, books one, and hands anything outside the rules to Dave. A handoff
lands in a second agent, `DavePhone`, which texts Dave the alert. Every booking is
posted there too, so Dave gets a text with who, when, where, and the price.

Notes for coding agents: [AGENTS.md](./AGENTS.md).

## Requirements

- Node.js 22.18 or later (the scripts in `scripts/` run `.ts` files directly).
- A Cloudflare account, logged in with `npx wrangler login`. The `AI` binding calls
  the real Workers AI model even in local dev, and that usage counts against the
  account.

## Setup

```sh
npm ci
cp .dev.vars.example .dev.vars   # then set SECRET and ACCESS_CODE
```

`.dev.vars` is gitignored. `ACCESS_CODE` is the shared code a reviewer types to sign
in. `SECRET` derives every visitor id and allowlist entry, so keep it fixed once you
have loaded the allowlist.

Sign-in also needs the nickname in the local allowlist. Keep the nickname list outside
the repo (one nickname per line; blank lines and lines starting with `#` are skipped),
turn it into allowlist entries with your `SECRET`, and load them into the local KV:

```sh
echo "my-test-nickname" > ~/allowlist-nicknames-local.txt
set -a; source .dev.vars; set +a
node scripts/allowlist.ts ~/allowlist-nicknames-local.txt > /tmp/allowlist.json
npx wrangler kv bulk put --binding ALLOWLIST --local /tmp/allowlist.json
rm /tmp/allowlist.json
```

If you change `SECRET`, load the allowlist again. For production, the same JSON goes
in with `--remote` instead of `--local`, and the secrets with
`npx wrangler secret put SECRET` / `npx wrangler secret put ACCESS_CODE`.

## Start the dev server

```sh
npx vite dev --port 8787 --strictPort
```

Use this fixed port: the frontend docs expect it. `npm run dev` also works, but it
takes Vite's default port 5173, which clashes with the frontend.

Start this server before the frontend one. Both want the Workers debugger port 9229;
if the frontend gets it first, this server stops with
`EADDRINUSE: address already in use 127.0.0.1:9229`.

## Try it with curl

Public routes need no token:

```sh
curl http://localhost:8787/api/health   # {"ok":true}
curl http://localhost:8787/api/config   # hours, town weekdays, prices, time zone
```

Sign in with the access code and an allowlisted nickname. The answer holds your
`visitorId` and a token that is valid for 2 hours (`expiresAt` is in Unix seconds):

```sh
curl -s -X POST http://localhost:8787/api/auth \
  -H 'content-type: application/json' \
  -d '{"accessCode":"<ACCESS_CODE>","nickname":"my-test-nickname"}'
# {"visitorId":"…","token":"…","expiresAt":…}
```

Use the token on the protected routes. The same nickname always gives the same
`visitorId`, from any browser or machine:

```sh
TOKEN=…; VISITOR_ID=…
curl http://localhost:8787/api/calendar/$VISITOR_ID -H "authorization: Bearer $TOKEN"
curl -X POST http://localhost:8787/api/calendar/$VISITOR_ID/reset -H "authorization: Bearer $TOKEN"

GENERATION=…   # "generation" from the calendar answer; each reset adds one
curl -X POST "http://localhost:8787/api/agents/lawn-desk/$VISITOR_ID:$GENERATION:+15550101" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"kind":"user","body":"How much to mow half an acre?"}'
curl "http://localhost:8787/api/agents/dave-phone/$VISITOR_ID:$GENERATION:dave" \
  -H "authorization: Bearer $TOKEN"   # Dave's phone: booking and handoff texts
```

## M1 check against the dev server

`scripts/m1.ts` drives the agent through the API alone. It signs in, resets the
calendar, books a slot through a scripted conversation, checks that a 2-acre request
reaches Dave's phone, and then sends off-script texts (a question after a handoff, a
greeting, a price question, haggling, a complaint). With the dev server running:

```sh
ACCESS_CODE=… NICKNAME=my-test-nickname node scripts/m1.ts
```

Use a made-up test nickname from the local allowlist. `BASE_URL` defaults to
`http://localhost:8787/api`. The script calls the real Workers AI model.

## Routes

All routes are under `/api` (`src/app.ts`).

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | public | Liveness check |
| `GET /api/config` | public | Dave's rules (`src/domain/rules.ts`): hours, town weekdays, prices, time zone |
| `POST /api/auth` | public | `{ accessCode, nickname }` → `{ visitorId, token, expiresAt }`; 401 for a wrong code or a nickname not in the allowlist |
| `GET /api/calendar/<visitorId>` | token | The visitor's generation, seed preset, customers, and bookings, plus `today` and `timeZone` (Dave's date, build-plan §12) |
| `POST /api/calendar/<visitorId>/reset` | token | New generation, no customers, a different seed preset dated from this week |
| `/api/agents/lawn-desk/<visitorId>:<generation>:<phone>` | token | A customer conversation with the Flue agent `LawnDesk` |
| `/api/agents/dave-phone/<visitorId>:<generation>:dave` | token | Dave's phone (`DavePhone`): booking and handoff texts for that generation |

Protected routes answer 401 for a missing, invalid, or expired token, 403 when the
path's `visitorId` is not the token's, and 429 once the visitor has made 30 writes
(agent messages and calendar resets; aborts are free) in 5 minutes. The agent routes
also answer 400 for a conversation id of the wrong kind or a posted message that is
not `kind: "user"` (handoff alerts come only from the server), and 409 for a message
to a generation older than the visitor's current one; old conversations stay readable. `<visitorId>` must match
`[A-Za-z0-9_-]{1,64}`, or the calendar route answers 400. Each visitor's calendar lives
in its own `VisitorStore` Durable Object (`visitor-<visitorId>`), which rejects
overlapping or rule-breaking bookings and also keeps the visitor's write counter.

## Scripts

| Command | What it does |
| --- | --- |
| `npm test` | Vitest suite for the domain rules, the booking store, sign-in, the auth guard, and the agent tools, prompts, and conversation guard (`vitest.config.ts`, kept apart from the Cloudflare Vite plugin) |
| `npm run check:types` | TypeScript type check |
| `npm run build` | Production build into `dist/` |
| `npm run deploy` | Build and deploy the Worker |
| `node scripts/allowlist.ts <list>` | Nickname list → allowlist KV entries (needs `SECRET` in the environment) |
| `node scripts/m1.ts` | M1 check against the dev server (needs `ACCESS_CODE` and `NICKNAME`) |

## Layout

```
src/
├─ app.ts         route map (auth guard first, then every route)
├─ cloudflare.ts  Worker exports (VisitorStore Durable Object)
├─ env.d.ts       binding and secret types
├─ agents/        LawnDesk (customer conversations) and DavePhone (booking and handoff texts)
├─ auth/          sign-in, nickname identity, signed token, 401/403/429 guard
├─ desk/          agent tools, prompts, and the per-conversation 400/409 guard
├─ domain/        Dave's rules, quote, slot finding, seed presets, conversation ids (pure, no I/O)
└─ store/         per-visitor booking calendar: ledger logic, Durable Object, routes
scripts/
├─ allowlist.ts   nickname list → allowlist KV entries
└─ m1.ts          M1 check against the dev server
test/
├─ app.test.ts    auth guard on the real app wiring
├─ auth/          identity, guard, and allowlist script tests
├─ desk/          tool, prompt, and conversation guard tests
├─ domain/        tests for src/domain
└─ store/         ledger and route tests (Node, in-memory fakes)
```
