# Session Handoff — akapal-geap chat system

**Date:** 2026-10-08
**Supersedes:** `SESSION_HANDOFF.md` (deleted; that one described the auth-core-only
state before any UI, BFF, or agent wiring existed).

> **Note (later):** the portal described here was ported off Next.js to an Express
> server (`server.js`) with a vanilla `public/` front end; see `README.md` and
> `ARCHITECTURE.md`. The portal paths and commands below (`src/**`, `proxy.ts`,
> `npm run build`/`lint`, `NODE_ENV=development`) no longer apply. The contracts —
> the `session` JWT cookie, the `/api/chat` seam, and the env vars — are unchanged.

**Status:** The portal is complete and verified, and **two** interchangeable BFF
implementations (TypeScript and Python) are built and verified end to end against
the **real** deployed agent. Nothing is committed anywhere yet.

Read this top-to-bottom before touching anything. It records the decisions, the
environment gotchas, and the exact contracts, so you do not have to re-derive them.

---

## 1. What this system is

Three tiers, three repos (all under `D:\vscode_projects`):

| Repo | Role | Stack |
|---|---|---|
| `akapal-geap-chat-portal` | Browser-facing app: login, session cookie, chat UI, BFF seam | Next.js 16 App Router, React 19, Tailwind v4, TS |
| `akapal-geap-bff` | BFF (TypeScript variant) | Express 4, TS (ESM), Node ≥22.5 |
| `akapal-geap-bff-python` | BFF (Python variant) — same contract | FastAPI, Agent Engine SDK |
| `akapal-geap-agent` | **Source** of the deployed agent (not the runtime) | Python ADK 2.6.2, `deploy_adk.py` |

The core idea the whole design hangs on: **a login session is not an agent
session.** The portal proves *who* the user is (JWT cookie); the agent owns *the
conversation* (ADK session keyed by `app_name/user_id/session_id`). The **BFF** is
the only component that knows both, and it owns the mapping between them plus the
authorization that goes with it.

Full design write-up: `ARCHITECTURE.md` (overview, per-component deep dive,
diagrams with explanations).

---

## 2. Decisions already made (do not relitigate without reason)

| Decision | Choice | Why |
|---|---|---|
| Identity | Portal's session JWT, HS256 via `jose`/`PyJWT`, `userId` claim | Stateless; no session table |
| Portal ↔ BFF auth | **Shared `SESSION_SECRET`**; portal forwards the JWT as `Authorization: Bearer` | BFF consumes the portal's identity; login stays in the portal |
| Session mapping | **BFF owns `user_id -> session_id`**, persisted (`node:sqlite` / stdlib `sqlite3`) | ADK will not map a login to a conversation |
| Authorization | **Mandatory ownership check** on any explicit `sessionId` | ADK's `user_id` is a label, not a guard |
| Agent target | `akapal-geap-agents`, engine `335803495506509824`, project `adk-tut-508714`, `us-central1` | Owned by the working Google account (see §3.4) |
| Agent calls | `:query async_create_session` + `:streamQuery stream_query` | The ADK `AdkApp` surface |
| Two BFFs | Both exist, same port (4000) and same contract → drop-in swap | Lets us compare TS vs Python; **decide which to keep** (§7.2) |

---

## 3. CRITICAL environment gotchas

1. **`NODE_ENV=production` is set globally in this shell.** Plain `npm install`
   omits devDependencies. Always `npm install --include=dev`. Also: never derive
   the cookie `Secure` flag from `NODE_ENV` — use the dedicated `COOKIE_SECURE`
   env var (else login silently fails over plain http on localhost).
2. **Next.js 16 is not the Next.js you know.** `middleware.ts` is deprecated and
   renamed **`proxy.ts`** (export a `proxy` function; Node runtime by default).
   Layout/page props use generated globals (`LayoutProps<"/">`). Route handler
   `context.params` is a Promise; type it with `RouteContext<'/path'>`. Bundled
   docs: `node_modules/next/dist/docs/`.
3. **`cacheComponents` is intentionally off** (scaffold had it on). If you
   re-enable it, session reads must go behind Suspense / `use cache: private`.
4. **Google credentials (ADC).** `gcloud auth application-default login` is
   configured as `authorized_user` = **`nguptaneha25@gmail.com`**, quota project
   `adk-tut-508714`. It can query engines in **`adk-tut-508714`** only. It **cannot
   even `describe`** `labs-gcp-msls-16495-1782829337` (the other person's project),
   which is why the original engine target returned `403 PERMISSION_DENIED`.
   Verify with: `gcloud projects describe adk-tut-508714`.
5. **`gcloud` 580 has no `ai reasoning-engines` subcommand.** List engines via the
   REST API (`GET https://us-central1-aiplatform.googleapis.com/v1/projects/adk-tut-508714/locations/us-central1/reasoningEngines`)
   or the SDK (`agentplatform.agent_engines.list(filter=...)`).
6. **Python BFF first boot looks hung.** Importing `agentplatform` (which pulls
   `google.adk`) takes a long time; uvicorn accepts connections only after it
   finishes. Give it ~1 minute before assuming failure.
7. **`node:sqlite` under Turbopack is fine** — verified, `next build` passes. No
   `serverExternalPackages` workaround needed.

---

## 4. What is DONE (all verified)

### 4.1 Portal (`akapal-geap-chat-portal`) — complete
- `src/lib/*` — definitions (zod), password (bcryptjs), db (node:sqlite `users`),
  session (jose JWT cookie), dal (`getSessionUserId` / `verifySession` /
  `getCurrentUser`).
- `src/app/actions/auth.ts` (login/logout), `src/proxy.ts` (optimistic guard),
  `src/app/login/*`, `src/app/chat/*`, `src/app/api/chat/route.ts` (the BFF seam).
- `scripts/seed.mjs` + `"seed"` npm script; `.env` / `.env.example` (incl. `BFF_URL`);
  `.gitignore` (`/data/`, `!.env.example`).
- `README.md`, `docs/AUTH.md`, `ARCHITECTURE.md`.
- **Verified:** `npm run lint` + `npm run build` clean; dev round-trip — `/chat`
  unauth → 307 `/login`, `/api/chat` unauth → 401, valid cookie → 200, `/login`
  authed → 307 `/chat`.

### 4.2 BFF TypeScript (`akapal-geap-bff`) — built, verified
- `src/auth.ts` (JWT), `src/store.ts` (SQLite `chat_threads`), `src/routes/chat.ts`
  (create-or-resume + ownership + stale-session retry), `src/agent/client.ts` +
  `src/agent/stream.ts` (REST + concatenated-JSON parser), `src/index.ts`.
- **Verified:** `tsc` build, 4/4 tests, endpoints 401/400/403/200, create + resume
  (agent remembered the prior turn), and portal → BFF → real agent → 200.

### 4.3 BFF Python (`akapal-geap-bff-python`) — built, verified
- `app/auth.py` (PyJWT), `app/store.py` (`sqlite3`), `app/main.py`
  (create-or-resume + ownership + retry), `app/agent.py` (Agent Engine SDK),
  `app/events.py` (event → text), `tests/test_logic.py`, `requirements.txt`.
- Simpler than the TS one: the SDK returns **parsed event dicts**, so no REST
  plumbing and no brace-depth parser (`agent.py` + `events.py` together are smaller
  than TS `agent/stream.ts` alone).
- **Verified:** venv build, 5/5 tests, endpoints 401/400/403/200, create + resume
  (memory confirmed), and portal → Python BFF → real agent → 200 **with zero portal
  changes**.

---

## 5. Contracts to keep consistent

**HTTP seam** (identical for both BFFs)

```
GET  /health                        -> { ok, engine }
POST /api/chat   Authorization: Bearer <portal session JWT>
                 { "message": str, "sessionId"?: str }
              -> { reply, userId, sessionId, resumed }      # errors: { error }
```

`resumed=false` = a new agent session was created this turn.

**Env vars**

| Repo | Vars |
|---|---|
| portal | `SESSION_SECRET`, `DATABASE_PATH=./data/app.db`, `COOKIE_SECURE=false`, `BFF_URL=http://localhost:4000` |
| BFF (either) | `PORT=4000`, `SESSION_SECRET` (= portal's), `DATABASE_PATH=./data/bff.db`, `GEAP_ENGINE_PROJECT=adk-tut-508714`, `GEAP_ENGINE_LOCATION=us-central1`, `GEAP_ENGINE_ID=335803495506509824` |

**Stores:** portal `data/app.db` (`users`) · BFF `data/bff.db`
(`chat_threads(user_id, session_id, created_at, last_seen_at)` — PK
`(user_id, session_id)`) · agent owns the conversation events/state.

**Ports:** portal `3000` (dev overridden to `3100` here) · BFF `4000`.

**Demo user:** `demo@example.com` / `demo1234`.

---

## 6. How to run / verify

```bash
# Portal
cd akapal-geap-chat-portal
npm install --include=dev
npm run seed
set NODE_ENV=development && npm run dev            # :3000

# BFF (pick one)
cd akapal-geap-bff && npm install && npm run build && npm start      # TS  :4000
cd akapal-geap-bff-python && uv venv .venv && uv pip install -r requirements.txt
  .venv\Scripts\python.exe -m uvicorn app.main:app --port 4000       # Py  :4000
```

`.env` already exists in all three repos (gitignored); the BFFs reuse the portal's
`SESSION_SECRET`. The agent calls need ADC with access to `adk-tut-508714`.

---

## 7. What is LEFT (ordered)

1. **Commit everything.** Nothing is committed. The portal has one scaffold commit
   plus a large uncommitted tree; `akapal-geap-bff` and `akapal-geap-bff-python` are
   not even `git init`'d.
2. **Decide which BFF to keep.** Both work; delete the one you don't want (or keep
   both deliberately). The Python one is the recommended keeper — less code, and it
   uses the supported SDK instead of hand-rolled REST/parse.
3. **Sanitize the upstream error.** The BFF returns the raw Google error on `502`,
   which leaks project/engine ids and IAM detail to the browser. Log it
   server-side, return a generic message to the client.
4. **Streaming (optional).** Both BFFs buffer the agent stream into one reply.
   Add an SSE relay when time-to-first-token matters.
5. **Docs.** Add the Python BFF to `ARCHITECTURE.md` (currently only the TS one is
   described).
6. **Production hardening (not this session):** service account instead of a
   personal ADC; a shared DB if the BFF is ever scaled past one process; session
   TTL/cleanup.

---

## 8. Known risks / watch-items

- **Both BFFs bind :4000** — run one at a time (or change `PORT`).
- **Ownership check is security-critical.** Removing it lets user A read user B's
  thread. It lives in each BFF's chat route; keep it.
- **Personal-account ADC** is fine locally but not shareable/CI-able — use a
  service account for anything beyond your machine.
- **`akapal-financial-planner`** (engine `6854616621567180800`) is an **A2A** agent,
  not the `AdkApp` class-method shape — the current BFF clients cannot drive it.

---

## 9. Quick file map

```
akapal-geap-chat-portal/
  src/lib/{definitions,password,db,session,dal}.ts   # auth core            [DONE]
  src/proxy.ts                                        # route guard          [DONE]
  src/app/actions/auth.ts                             # login/logout         [DONE]
  src/app/login/*, src/app/chat/*                     # UI                   [DONE]
  src/app/api/chat/route.ts                           # BFF seam             [DONE]
  scripts/seed.mjs                                    # demo user            [DONE]
  README.md, docs/AUTH.md, ARCHITECTURE.md            # docs                 [DONE]
  ADK_SESSION_AND_BFF.md                              # design basis (read-only reference)

akapal-geap-bff/            # TS BFF  (Express)  — built + verified  [DONE]
akapal-geap-bff-python/     # Py BFF  (FastAPI)  — built + verified  [DONE]
akapal-geap-agent/          # agent source + deploy_adk.py (source of the engine)
```
