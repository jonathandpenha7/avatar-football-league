import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");

/** A fresh in-memory Postgres with the real Supabase migrations applied. */
export async function createTestDb() {
  // Return dates and timestamps as strings, as Supabase's REST API does.
  const asText = (v: string) => v;
  const db = new PGlite({ parsers: { 1082: asText, 1114: asText, 1184: asText } });
  await db.exec(readFileSync(join(__dirname, "supabase-shim.sql"), "utf8"));
  const dir = join(root, "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(dir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

/** Create an auth user (the trigger creates the profile). */
export async function createUser(db: TestDb, email: string, name = email.split("@")[0]) {
  await asService(db);
  const res = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ full_name: name })],
  );
  return res.rows[0].id;
}

/** Act as a signed-in user: RLS applies. */
export async function asUser(db: TestDb, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

export async function asAnon(db: TestDb) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role anon");
}

/** Superuser connection with no auth context (like migrations / service role). */
export async function asService(db: TestDb) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}
