# akapal-geap-chat-portal

Standalone Next.js full-stack portal: a logged-in user gets a chat window. Login
is local (a seeded demo user) with a stateless JWT session in an httpOnly cookie.

This is the front end / auth layer. `src/app/api/chat/route.ts` is the **BFF
seam** — the file that will later call the BFF + Google ADK agent.

## Stack

- Next.js 16 App Router, TypeScript, Tailwind v4
- SQLite via Node's built-in `node:sqlite` (no external server)
- `bcryptjs` for password hashing, `jose` for the session JWT, `zod` for validation

## Run

```bash
npm install --include=dev   # NODE_ENV=production is set in some shells; --include=dev keeps devDeps
npm run seed                # create the demo user
set NODE_ENV=development && npm run dev
```

Open http://localhost:3000 and sign in with **demo@example.com / demo1234**.

## Environment

Copy `.env.example` to `.env`:

| Var | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | yes | HS256 signing key for the session cookie |
| `DATABASE_PATH` | no | defaults to `./data/app.db` |
| `COOKIE_SECURE` | no | `true` only behind HTTPS; keep `false` locally |

## The `/api/chat` seam

`POST /api/chat` with `{ "message": "..." }`. It requires a valid session cookie
(returns `401` otherwise) and currently returns a stubbed reply. Step 2 replaces
the stub with a call to the BFF, which owns the `user_id -> ADK session_id`
mapping and authorization. See `ADK_SESSION_AND_BFF.md` and `docs/AUTH.md`.

## Scripts

- `npm run dev` — dev server
- `npm run build` / `npm start` — production build / serve
- `npm run lint` — ESLint
- `npm run seed` — seed the demo user
