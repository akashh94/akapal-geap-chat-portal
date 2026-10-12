# akapal-geap-chat-portal

Standalone Express-served portal (no framework, no build step): a logged-in user
gets a chat window. Login is local (a seeded demo user) with a stateless JWT
session in an httpOnly cookie.

This is the front end / auth layer. `server.js`'s `POST /api/chat` is the **BFF
seam** — the route that calls the BFF + Google ADK agent.

## Stack

- Node ≥22.5, Express 4 in a single `server.js` (no bundler, no build step)
- Vanilla-JS front end under `public/` (HTML + CSS + plain `<script>`)
- SQLite via Node's built-in `node:sqlite` (no external server)
- `bcryptjs` for password hashing, `jose` for the session JWT, `zod` for validation

## Run

```bash
npm install
npm run seed                # create the demo user
npm run dev                 # node --watch server.js
```

Open http://localhost:3000 and sign in with **demo@example.com / demo1234**.

`npm start` runs the same server without watch. Chat needs the BFF up at
`BFF_URL` (default `http://localhost:4000`); without it `/api/chat` returns
`502 {"error":"BFF unreachable"}`.

## Environment

Copy `.env.example` to `.env`:

| Var | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | yes | HS256 signing key for the session cookie (shared with the BFF) |
| `DATABASE_PATH` | no | defaults to `./data/app.db` |
| `COOKIE_SECURE` | no | `true` only behind HTTPS; keep `false` locally |
| `BFF_URL` | no | base URL of the BFF, default `http://localhost:4000` |
| `PORT` | no | listen port, default `3000` |

## The `/api/chat` seam

`POST /api/chat` with `{ "message": "..." }`. It requires a valid session cookie
(returns `401` otherwise) and forwards the turn to the BFF as
`Authorization: Bearer <session JWT>`, relaying the reply as a
`text/event-stream`. See `ADK_SESSION_AND_BFF.md` and `docs/AUTH.md`.

## Scripts

- `npm run dev` — dev server (`node --watch server.js`)
- `npm start` — run the server
- `npm run seed` — seed the demo user
