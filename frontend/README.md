# Dave's Lawn Desk — frontend

Cloudflare Worker `dave-lawn-desk-web`. It serves the web SMS simulator (React) and
runs a thin proxy worker (`worker/index.ts`) that forwards `/api/*` to the backend
through the `API` service binding, so the browser talks to one origin and needs no
CORS.

The simulator has a sign-in screen, the customer's side (a phone that texts the
lawn-desk agent, a customer card with a town map, suggested replies, booking status),
Dave's side (his week calendar, his work hours, town days, and prices, and his phone
with handoff alerts), and a judgment log of the agent's tool calls and reasoning.

Backend: [../backend/README.md](../backend/README.md).

## Requirements

- Node.js 22 or later.
- The backend dev server running on port 8787, as in
  [../backend/README.md](../backend/README.md). Without it, every `/api/*` call fails.

## Setup

```sh
npm ci
```

The frontend has no secrets.

## Start the dev server

Start the backend first, then the frontend in another terminal:

```sh
# in ../backend
npx vite dev --port 8787 --strictPort
# in this folder
npx vite dev --port 5180 --strictPort
```

Open http://localhost:5180. In local dev the Cloudflare Vite plugin connects the `API`
service binding to the backend dev server.

## Use the simulator

1. Sign in with the backend's `ACCESS_CODE` and a nickname from the local allowlist
   (see [../backend/README.md](../backend/README.md) "Setup"). A wrong code or an
   unknown nickname gets the same error, which does not say which one was wrong.
2. The customer's side opens with a made-up customer. Until the first text you can
   change the street, town, and yard size on the customer card; after it they lock.
3. Text from the phone, or tap a suggested reply. While the agent works the phone
   shows "typing…", and the reply appears once it is complete. The judgment log docked at
   the bottom shows each tool call (input and output) and the reasoning: it starts
   collapsed (click its title to open it, drag its top edge to resize it).
4. **New customer** starts a new conversation with a new number and a name that is
   not already on Dave's calendar; the calendar stays.
   Customers who texted can be reopened from the drop-down at the top of the panel.
5. The switch in the middle widens the customer side, Dave's side, or both. Dave's
   side shows his calendar (each day with its towns; Wednesday is off), and below it
   his town days, work hours, and prices from `/api/config`. The round button at the bottom right
   opens his phone (read-only): the desk texts Dave every booking and every handoff,
   and a red badge counts new texts. Going back to the customer side closes it.
6. When the desk's reply confirms a booking, both sides open after a short pause and
   the new booking lands in Dave's calendar. After a handoff, the alert arrives in
   Dave's phone and its button shows a badge. Both wait for the desk's text to reach the customer phone; only the
   judgment log updates while the desk is still working.
7. The "Your location" map in the customer card shows every town and marks where the
   customer lives; with Dave's side open it also colours each town by Dave's weekdays
   and says whether Dave mows there.
8. **Reset all** (top right, asks first) gives Dave a new schedule and starts fresh
   conversations with a new customer.

The nickname stays in `localStorage` to prefill the form; the token stays in this
tab's `sessionStorage` until it expires (2 hours). The access code is not stored. The
open customer and the earlier customers stay in `localStorage` per nickname, so a new
tab or a restarted browser reopens them. **Sign out** (top right) forgets the token in
this tab and keeps the rest. A 401 from any call (expired or altered token) returns to sign-in with the nickname
filled in, and signing in again reopens the same calendar and conversations. If the
calendar was reset elsewhere, the next text goes to a new conversation and the phone
says so.

The API also works through the proxy, as in [../backend/README.md](../backend/README.md)
"Try it with curl" with `localhost:5180` in place of `localhost:8787`:

```sh
curl http://localhost:5180/api/health   # {"ok":true}, answered by the backend
```

`npm run dev` also works, but both projects default to Vite's port 5173, so pass
explicit ports when running them together.

### Troubleshooting

- **Backend fails with `EADDRINUSE: address already in use 127.0.0.1:9229`:** both dev
  servers want the Workers debugger port 9229. The frontend falls back to 9230 on its
  own, but the backend stops. Start the backend first and wait until
  `curl http://localhost:8787/api/health` answers before starting the frontend.
- **`Worker "dave-lawn-desk-api" not found. Make sure it is running locally.`:** the
  backend dev server is not running (or failed to start). Start it, then retry.

## Scripts

| Command | What it does |
| --- | --- |
| `npm test` | Vitest: proxy worker tests and the simulator's pure UI logic in `src/lib/` (Node, no DOM) |
| `npm run lint` | oxlint |
| `npm run build` | Type check (`tsc -b`) and production build |
| `npm run deploy` | Build and deploy the Worker (deploy the backend first) |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |

## Layout

```
src/
├─ App.tsx        sign-in ↔ simulator
├─ SignIn.tsx     access code + nickname form
├─ Simulator.tsx  panels, layout switch, customer conversation (useFlueAgent)
├─ CustomerPhone.tsx, CustomerCard.tsx, CustomerSwitcher.tsx, SidePanels.tsx, TownMap.tsx
├─ DavePanel.tsx  calendar (FullCalendar v7), Dave's phone, prices and towns
├─ JudgmentLog.tsx  tool calls and reasoning
└─ lib/           pure logic with tests: API calls, session, conversation ids,
                  transcript, 409 recovery, layout, customer card, roster,
                  suggested replies, booking status, log formatting,
                  calendar, /config rules, booking reveal, town map
worker/index.ts   serves the SPA, forwards /api/* to the backend binding
```
