# Auth flow

Local credentials auth: email + password checked against a `users` row, then a
stateless JWT session in an httpOnly cookie. No external identity provider.

```mermaid
sequenceDiagram
  participant U as Browser
  participant A as POST /login (server.js)
  participant DB as SQLite (users)
  U->>A: submit email + password
  A->>A: validate with zod (LoginFormSchema)
  A->>DB: findUserByEmail(email)
  DB-->>A: user row (or none)
  A->>A: bcrypt verifyPassword
  A->>A: createSession(user.id) -> sign JWT (jose HS256)
  A-->>U: Set-Cookie: session=... (httpOnly, sameSite=lax)
  A-->>U: redirect /chat
```

## Two layers of protection

1. **Guard — `requireAuth` / `redirectIfAuthed` in `server.js`.** Run on
   `GET /chat` and `GET /login`. Verify the cookie with jose and redirect:
   unauthenticated `/chat` → `/login`, authenticated `/login` → `/chat`. Cookie
   only, no DB access.
2. **API check — `requireAuthJson` in `server.js`.** The `/api/*` routes assert
   the same session and return `401` instead of redirecting.

```mermaid
flowchart TD
  R["Request"] --> P{"requireAuth: valid session cookie?"}
  P -- "no" --> L["/login"]
  P -- "yes" --> D["serve /chat + load the user row"]
  D -- "ok" --> C["/chat renders"]
  D -- "missing user" --> L
```

## Identity

Identity is `session.userId` — a stable user id, never the email. This is the
value that becomes the ADK `user_id` in step 2 (see `ADK_SESSION_AND_BFF.md`).

| Concern | Where |
|---|---|
| Password hashing | `server.js` (bcryptjs, 10 rounds) |
| User store | `server.js` (node:sqlite) |
| Session cookie | `server.js` (jose, 7-day TTL) |
| Auth checks | `server.js` (`verifySession`, `requireAuth`, `requireAuthJson`) |
| Login / logout | `server.js` (`POST /login` / `GET /logout`) |
| Guards | `server.js` (`redirectIfAuthed`) |
