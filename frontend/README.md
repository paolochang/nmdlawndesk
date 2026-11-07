# Dave's Lawn Desk — frontend

Cloudflare Worker `dave-lawn-desk-web`. It serves a React chat page (the walking
skeleton of the web SMS simulator) and runs a thin proxy worker (`worker/index.ts`)
that forwards `/api/*` to the backend through the `API` service binding, so the
browser talks to one origin and needs no CORS.

Later PRs replace the chat page with the simulator (sign-in, customer phone, Dave's
panel) and extend this README with each.

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

The chat page cannot reach the agent right now: the backend requires a sign-in token
on `/api/agents/*`, and this page has no sign-in screen yet, so a message gets 401. The
sign-in screen comes in a later PR. Until then, use the API through the proxy with
curl, as in [../backend/README.md](../backend/README.md) "Try it with curl" with
`localhost:5180` in place of `localhost:8787`:

```sh
curl http://localhost:5180/api/health   # {"ok":true}, answered by the backend
curl -s -X POST http://localhost:5180/api/auth \
  -H 'content-type: application/json' \
  -d '{"accessCode":"<ACCESS_CODE>","nickname":"my-test-nickname"}'
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
| `npm test` | Vitest: proxy worker tests |
| `npm run lint` | oxlint |
| `npm run build` | Type check (`tsc -b`) and production build |
| `npm run deploy` | Build and deploy the Worker (deploy the backend first) |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |

## Layout

```
src/              React chat page (App.tsx, main.tsx)
worker/index.ts   serves the SPA, forwards /api/* to the backend binding
```
