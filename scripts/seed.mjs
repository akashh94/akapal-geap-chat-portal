import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";

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

const email = "demo@example.com";
const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);

if (existing) {
  console.log(`Demo user ${email} already exists, skipping.`);
} else {
  const passwordHash = await bcrypt.hash("demo1234", 10);
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    email,
    "Demo User",
    passwordHash,
    new Date().toISOString(),
  );
  console.log(`Seeded demo user ${email} / demo1234`);
}
