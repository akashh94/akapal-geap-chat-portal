"use strict";

require("dotenv").config();

const express = require("express");
const compression = require("compression");
const path = require("path");
const { mkdirSync } = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { Readable } = require("node:stream");
const { SignJWT, jwtVerify } = require("jose");
const bcrypt = require("bcryptjs");
const z = require("zod");

// --- config ----------------------------------------------------------------

const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
const BFF_URL = process.env.BFF_URL ?? "http://localhost:4000";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Disable buffering in front of the app (nginx-style reverse proxies).
  "X-Accel-Buffering": "no",
};

// --- database (node:sqlite) -------------------------------------------------

const dbPath =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");
mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

function findUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
}

function findUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

// --- validation -------------------------------------------------------------

const LoginFormSchema = z.object({
  email: z.email({ error: "Enter a valid email address." }).trim(),
  password: z.string().min(1, { error: "Password is required." }),
});

// --- session (signed JWT cookie, same contract the BFF verifies) ------------

function getCookie(req, name) {
  const header = req.headers.cookie ?? "";
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function signSession(userId, expiresAt) {
  return new SignJWT({ userId, expiresAt: expiresAt.toISOString() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

async function createSession(res, userId) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const token = await signSession(userId, expiresAt);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

async function verifySession(req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    return payload;
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const payload = await verifySession(req);
  if (!payload) return res.redirect("/login");
  req.userId = payload.userId;
  next();
}

async function requireAuthJson(req, res, next) {
  const payload = await verifySession(req);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  req.userId = payload.userId;
  next();
}

async function redirectIfAuthed(req, res, next) {
  const payload = await verifySession(req);
  if (payload) return res.redirect("/chat");
  next();
}

// --- app --------------------------------------------------------------------

const app = express();
const publicDir = path.join(__dirname, "public");

app.disable("x-powered-by");
app.use(
  compression({
    filter: (req, res) =>
      // SSE must not be gzipped/buffered.
      req.path === "/api/chat" ? false : compression.filter(req, res),
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Pages (defined before static, so the guards are not bypassed by the files).
app.get("/", (_req, res) => res.redirect("/chat"));
app.get("/login", redirectIfAuthed, (_req, res) =>
  res.sendFile(path.join(publicDir, "login.html")),
);
app.get("/chat", requireAuth, (_req, res) =>
  res.sendFile(path.join(publicDir, "chat.html")),
);

// Auth API.
app.post("/login", async (req, res) => {
  const parsed = LoginFormSchema.safeParse({
    email: req.body?.email,
    password: req.body?.password,
  });
  if (!parsed.success) {
    const errors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      (errors[key] ??= []).push(issue.message);
    }
    return res.status(400).json({ errors });
  }

  const { email, password } = parsed.data;
  const user = findUserByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  await createSession(res, user.id);
  res.json({ ok: true });
});

app.get("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.redirect("/login");
});

app.get("/api/me", requireAuthJson, (req, res) => {
  const user = findUserById(req.userId);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ id: user.id, name: user.name, email: user.email });
});

// BFF seam: this route hands the turn to the BFF, which owns the
// user_id -> agent session_id mapping and the authorization check. The portal
// only proves who the user is (its session JWT) and forwards.
app.post("/api/chat", requireAuthJson, async (req, res) => {
  const message =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  const token = getCookie(req, SESSION_COOKIE) ?? "";

  let upstream;
  try {
    upstream = await fetch(`${BFF_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message, sessionId: req.body?.sessionId }),
    });
  } catch {
    return res.status(502).json({ error: "BFF unreachable" });
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  // Streaming BFF: relay the event stream straight through, unbuffered.
  if (
    upstream.ok &&
    upstream.body &&
    contentType.includes("text/event-stream")
  ) {
    res.writeHead(200, SSE_HEADERS);
    Readable.fromWeb(upstream.body).pipe(res);
    return;
  }

  // Non-streaming BFF (or an error): normalise the JSON to one SSE document,
  // so the browser only ever has to understand one protocol.
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !data) {
    return res
      .status(upstream.status || 502)
      .json(data ?? { error: "Bad response from BFF" });
  }

  const reply = typeof data.reply === "string" ? data.reply : "";
  res.writeHead(200, SSE_HEADERS);
  res.write(
    sseFrame({
      type: "meta",
      userId: data.userId,
      sessionId: data.sessionId,
      resumed: data.resumed,
    }),
  );
  if (reply) res.write(sseFrame({ type: "delta", text: reply }));
  res.write(sseFrame({ type: "done", reply }));
  res.end();
});

function sseFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

// Static assets last (css/js and the direct .html files).
app.use(express.static(publicDir, { extensions: ["html"] }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`akapal-geap chat portal running at http://localhost:${port}`);
});
