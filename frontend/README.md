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

Open http://localhost:5180 and send a message. In local dev the Cloudflare Vite plugin
connects the `API` service binding to the backend dev server. "typing…" shows while
the reply streams in.

Check the proxy without the browser:

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
