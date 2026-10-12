# 3. End-to-end flows

Sequence diagrams for the paths that matter, each followed by a note explaining
what to look at. The BFF's internal algorithm is in
[`02-bff-deep-dive.md`](./02-bff-deep-dive.md); this page is about what crosses
the wire, turn by turn.

---

## 3.1 Login — establishing the identity

Login happens entirely in the portal. Its only relevance to the BFF is that the
cookie it sets is the token the BFF later verifies.

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant A as POST /login (server.js)
  participant DB as SQLite users
  participant CK as Session cookie

  U->>A: submit email + password
  A->>A: parse with LoginFormSchema (zod)
  A->>DB: findUserByEmail(email)
  DB-->>A: user row or none
  alt credentials valid
    A->>A: verifyPassword (bcrypt)
    A->>CK: createSession(user.id) -> sign HS256 JWT
    A-->>U: Set-Cookie session + redirect /chat
  else invalid
    A-->>U: "Invalid email or password."
  end
```

**Reading this diagram.** Time flows down. The `alt/else` block is a branch:
only one arm runs. The credentials are validated against the `users` row and
never leave the server, and the output of the happy path is a signed httpOnly
cookie whose payload is `{ userId, expiresAt }`. Everything downstream — including
the BFF — depends on that cookie and the `userId` inside it.

---

## 3.2 First turn — a new agent session

The user's first message. No thread exists yet, so the BFF creates one.

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant P as Portal /api/chat
  participant B as BFF /api/chat
  participant DB as BFF SQLite
  participant A as Agent Engine

  U->>P: POST /api/chat { message }  (+ session cookie)
  P->>P: requireAuthJson -> userId (401 if none)
  P->>B: POST /api/chat Authorization: Bearer jwt
  B->>B: verify_portal_token -> userId
  B->>DB: get_active_thread(userId) -> none
  B->>A: async_create_session(user_id)
  A-->>B: session_id = s1
  B->>DB: save_thread(userId, s1)
  B->>A: async_stream_query(..., streaming_mode=sse)
  A-->>B: first text delta
  B-->>P: SSE meta { sessionId: s1, resumed: false }
  loop each delta
    B-->>P: SSE { type: delta, text }
  end
  B->>DB: save_thread(userId, s1)  (refresh last_seen_at)
  B-->>P: SSE { type: done, reply }
  P-->>U: relays the frames as they arrive
```

**Reading this diagram.** The BFF is the pivot: it is the only column that talks
to both the database and the agent. Because `get_active_thread` returned nothing,
the create arm runs — `async_create_session`, then `save_thread`, then the turn.
The reply now **streams**: the BFF pulls the first delta (which is how it also
detects a dead session before sending anything), emits the `meta` frame with
`resumed: false`, then relays each `delta` as it arrives and closes with `done`.
`resumed: false` reports that a new session was created. The portal appears twice
on purpose: once doing its own auth, once relaying the BFF's frames verbatim
(`{ type: delta }` frames go straight through to the browser).

---

## 3.3 Resumed turn — continuing the thread

The second and later messages. The client now holds a `sessionId` from the
previous reply and sends it back, which exercises the explicit-resume *and*
ownership paths.

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant P as Portal /api/chat
  participant B as BFF /api/chat
  participant DB as BFF SQLite
  participant A as Agent Engine

  U->>P: POST /api/chat { message, sessionId: s1 }
  P->>B: POST /api/chat (Bearer jwt, same body)
  B->>B: verify_portal_token -> userId
  B->>DB: owns_thread(userId, s1) -> true
  B->>A: async_stream_query(..., streaming_mode=sse)
  A-->>B: first text delta (thread continues, remembers earlier turns)
  B-->>P: SSE meta { sessionId: s1, resumed: true }
  loop each delta
    B-->>P: SSE { type: delta, text }
  end
  B->>DB: save_thread(userId, s1)  (refresh last_seen_at)
  B-->>P: SSE { type: done, reply }
  P-->>U: relays the frames as they arrive
```

**Reading this diagram.** Same skeleton as 3.2, but two differences carry all the
meaning. First, the client sends `sessionId: s1`, so the BFF takes the
explicit-resume path and runs `owns_thread` — the authorization check — instead
of looking up the active thread. Second, the agent is handed the *same*
`session_id`, so the thread continues and the model remembers earlier turns.
`resumed: true` reports which path ran. The portal is unchanged from 3.2:
identity in, frames out.

---

## 3.4 Ownership rejection — a thread that is not yours

If a client sends a `sessionId` belonging to another user, the BFF refuses before
touching the agent.

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant B as BFF /api/chat
  participant DB as BFF SQLite

  U->>B: POST /api/chat { message, sessionId: other_users_thread }
  B->>B: verify_portal_token -> userId
  B->>DB: owns_thread(userId, other_users_thread) -> false
  B-->>U: 403 { "error": "Not your session" }
  Note over B,A: the agent is never called
```

**Reading this diagram.** The check happens in `owns_thread` (step 3), before any
agent call — note there is no Agent Engine column at all, because the request
never gets that far. This is the security-critical path: ADK's `user_id` is a
label, not a guard, so if this check were removed a user could read another
user's conversation simply by passing its id. The `403` tells the client the
thread is not theirs without revealing whether it exists.

---

## 3.5 Stale-session recovery — self-healing a dead thread

An agent session can be evicted or expired between turns. When the next turn
fails with a "session not found" error, the BFF recreates once rather than
returning an error.

```mermaid
sequenceDiagram
  autonumber
  participant B as BFF /api/chat
  participant DB as BFF SQLite
  participant A as Agent Engine

  B->>A: async_stream_query(..., session_id: s1)
  A-->>B: error containing "session" + "not found"
  B->>B: _looks_like_missing_session -> AgentSessionNotFoundError
  B->>A: async_create_session(user_id)
  A-->>B: session_id = s2
  B->>DB: save_thread(userId, s2)
  B->>A: async_stream_query(..., session_id: s2)
  A-->>B: first text delta
  B-->>B: SSE meta { sessionId: s2, resumed: false }
  B->>DB: save_thread(userId, s2)
  B-->>B: SSE { type: done, reply }
```

**Reading this diagram.** Steps 1-2 are the failure; step 3 is the
re-classification (a string match, see the deep dive); steps 4-5 create and
persist a *fresh* session, and step 6 retries the turn against it. The retry
happens exactly once — and because it happens while pulling the *first* delta,
before the stream opens, a second failure is still a clean `502` rather than a
half-sent reply. Because a new session was created, `resumed` flips back to
`false`. The user sees a normal reply; the dead thread is invisible to them.

---

## 3.6 BFF unreachable — failing at the seam

The portal is a thin forwarder, so if the BFF is down the failure is reported at
the portal layer.

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant P as Portal /api/chat
  participant B as BFF (down)

  U->>P: POST /api/chat { message }
  P->>P: requireAuthJson -> userId (ok)
  P->>B: fetch BFF_URL/api/chat
  B--xP: connection refused
  P-->>U: 502 { "error": "BFF unreachable" }
```

**Reading this diagram.** The portal has already established the user's identity
(step 2 passes), so this is not an auth failure. The `x` on the arrow marks the
failed connection. The portal catches the `fetch` rejection and returns its own
`502 {"error": "BFF unreachable"}` — a distinct, portal-owned message, so you can
tell "BFF is down" apart from "BFF answered with an upstream error" (which
returns the BFF's own `502` body). The browser surfaces whichever `error` string
it received.

---

## Where each status comes from

| Status | Produced by | Trigger |
|---|---|---|
| `401` | portal, then BFF | no/invalid session cookie (portal) or invalid JWT (BFF) |
| `400` | portal, then BFF | missing/empty `message` |
| `403` | BFF | `sessionId` not owned by the caller |
| `502 BFF unreachable` | portal | the BFF could not be reached |
| `502 <detail>` | BFF | the agent call failed before the stream opened |
| `200` + `{type:"error"}` frame | BFF | the agent failed after the stream opened |
| `200` + streamed frames | BFF | the turn completed (`delta` frames, then `done`) |
