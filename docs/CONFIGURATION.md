# Configuration — chat portal & BFF

Two services run side by side and are wired together by environment variables:

| Service | Repo | Default port |
|---|---|---|
| Chat portal | `akapal-geap-chat-portal` | `3000` |
| BFF | `akapal-geap-bff-python` | `4000` |

Both read their config from a local **`.env`** file (loaded with `dotenv`), so the
same file layout works on any machine. Each repo commits a `.env.example` and
gitignores the real `.env`.

## The one shared value: `SESSION_SECRET`

The portal *signs* the session cookie; the BFF *verifies* it. That trust is built
on a single shared secret:

- **`SESSION_SECRET` must be identical in both `.env` files.**
- Portal: signs an HS256 JWT `{ userId, expiresAt }` with it and stores it in the
  `session` cookie (`server.js` → `signSession`).
- BFF: verifies the same token with it and recovers `userId` (`app/auth.py`).

If they differ, the portal works but every turn fails at the BFF with **`401`**.
If `SESSION_SECRET` is missing from the BFF, it prints
`[bff] SESSION_SECRET is not set; portal sessions cannot be verified.`

Generate a strong value once and paste it into both files:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or:  openssl rand -hex 32
```

---

## 1. Chat portal (`akapal-geap-chat-portal`)

Copy the example and edit:

```bash
cp .env.example .env          # Windows: copy .env.example .env
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SESSION_SECRET` | **yes** | — | HS256 key for the session cookie. **Same value as the BFF.** |
| `DATABASE_PATH` | no | `./data/app.db` | SQLite file for the `users` table |
| `COOKIE_SECURE` | no | `false` | `true` only when served over HTTPS; keep `false` on localhost |
| `BFF_URL` | no | `http://localhost:4000` | Where `/api/chat` forwards turns — **must match where the BFF runs** |
| `PORT` | no | `3000` | Port the portal listens on |

Example `.env`:

```dotenv
SESSION_SECRET=LS5It0zTOy5lP31Nrn-I7YYWGwi9H-K2lrzxQleC92xrxKX7JlflFUxFJoHvrSlw
DATABASE_PATH=./data/app.db
COOKIE_SECURE=false
BFF_URL=http://localhost:4000
PORT=3000
```

Run it:

```bash
npm install
npm run seed        # creates demo@example.com / demo1234
npm run dev         # node --watch server.js  →  http://localhost:3000
```

`npm start` runs the same server without watch. Requires **Node ≥22.5** (for the
built-in `node:sqlite`).

### Deploying the portal

`build.sh` / `deploy.sh` source **`geap.deploy.env`** for the non-secret deploy
config (`PROJECT_ID`, `REGION`, `ARTIFACT_REGISTRY`, `SERVICE_NAME`, `BFF_URL`).
`SESSION_SECRET` is never committed — export it before deploying (ideally via
Secret Manager):

```bash
export SESSION_SECRET=<the value the BFF also uses>
./build.sh && ./deploy.sh
```

`deploy.sh` forces `COOKIE_SECURE=true` and passes `BFF_URL` through to Cloud Run
(port `8080`). Set `BFF_URL` in `geap.deploy.env` to the **deployed** BFF URL, not
`localhost`.

---

## 2. BFF (`akapal-geap-bff-python`)

Copy the example and edit:

```bash
cp .env.example .env          # Windows: copy .env.example .env
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SESSION_SECRET` | **yes** | — | Must equal the portal's, to verify its JWT |
| `PORT` | no | `4000` | Port the BFF listens on (the portal's `BFF_URL` targets this) |
| `DATABASE_PATH` | no | `./data/bff.db` | SQLite file for the `user_id -> session_id` mapping |
| `GEAP_ENGINE_PROJECT` | no | `adk-tut-508714` | Project of the deployed ADK agent (Reasoning Engine) |
| `GEAP_ENGINE_LOCATION` | no | `us-central1` | Region of that engine |
| `GEAP_ENGINE_ID` | no | `335803495506509824` | Reasoning Engine id (`akapal-geap-agents`) |

Example `.env`:

```dotenv
PORT=4000
SESSION_SECRET=LS5It0zTOy5lP31Nrn-I7YYWGwi9H-K2lrzxQleC92xrxKX7JlflFUxFJoHvrSlw
DATABASE_PATH=./data/bff.db

GEAP_ENGINE_PROJECT=adk-tut-508714
GEAP_ENGINE_LOCATION=us-central1
GEAP_ENGINE_ID=335803495506509824
```

Run it:

```bash
python -m venv .venv
.venv\Scripts\activate            # or: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 4000
```

### Credentials (required to actually talk to the agent)

The BFF reaches the agent with Google **Application Default Credentials**, so the
machine needs a login whose identity can query the engine's project:

```bash
gcloud auth application-default login
```

Without it the BFF still starts and `/health` returns `200`, but `/api/chat`
returns **`502`** with the upstream error.

---

## How the two connect

```
Browser ──▶ portal :3000 ──(Authorization: Bearer <session JWT>)──▶ BFF :4000 ──▶ Agent Engine
             │                                                            │
        SESSION_SECRET ──────────── must match ───────────────────── SESSION_SECRET
        BFF_URL ──────────────── points at ──────────────────────── PORT
```

Two values tie them together:

| Portal setting | Must agree with | Symptom if wrong |
|---|---|---|
| `SESSION_SECRET` | BFF `SESSION_SECRET` | BFF returns `401` on every turn |
| `BFF_URL` | BFF host + `PORT` | Portal returns `502 {"error":"BFF unreachable"}` |

Everything else is independent.

## Quick start (both, locally)

```bash
# Terminal 1 — BFF
cd akapal-geap-bff-python
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env            # set SESSION_SECRET to match the portal
uvicorn app.main:app --port 4000

# Terminal 2 — Portal
cd akapal-geap-chat-portal
npm install && npm run seed
copy .env.example .env            # set the same SESSION_SECRET
npm run dev                       # → http://localhost:3000
```

Sign in with **demo@example.com / demo1234**, then chat. `GET
http://localhost:4000/health` should return `{"ok": true, ...}` — if the portal
says "BFF unreachable", that endpoint is the first thing to check.
