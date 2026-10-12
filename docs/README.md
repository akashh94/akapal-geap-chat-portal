# BFF documentation

These docs explain the **BFF** (backend-for-frontend) that sits between the
logged-in chat portal and the deployed Google ADK agent. The focus is the
**Python BFF** (`akapal-geap-bff-python`, FastAPI + the Agent Engine SDK). The
portal is described only at the level needed to understand what the BFF consumes
(an identity) and what it drives (the agent), and the agent is treated as the
remote service the BFF calls.

If you have never touched this system, read in this order:

1. [`01-architecture.md`](./01-architecture.md) — the three tiers, the one idea
   the whole design hangs on, and a concise overview of the portal.
2. [`02-bff-deep-dive.md`](./02-bff-deep-dive.md) — the centerpiece: the BFF
   module by module, with the create-or-resume algorithm, failure modes and the
   deliberate simplifications.
3. [`03-flows.md`](./03-flows.md) — end-to-end sequence diagrams: login, first
   turn, resume, ownership rejection, stale-session recovery.
4. [`04-contracts.md`](./04-contracts.md) — the exact seam: HTTP surface, status
   codes, environment variables, database schemas, and the agent operations.

Background material that already exists and is **not** replaced by these docs:

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — the whole system end to end
  (portal + the TypeScript BFF + the agent).
- [`../ADK_SESSION_AND_BFF.md`](../ADK_SESSION_AND_BFF.md) — why ADK sessions
  are not login sessions, and the general BFF pattern. This is the design basis
  for everything below.
- [`./AUTH.md`](./AUTH.md) — the portal's login/auth flow in detail.
- [`./CONFIGURATION.md`](./CONFIGURATION.md) — how to set the environment
  variables in both projects, and the two values that must agree.

Each diagram in these docs is followed by a **Reading this diagram** note that
explains the shapes, arrows and labels, so the diagram stands on its own.
