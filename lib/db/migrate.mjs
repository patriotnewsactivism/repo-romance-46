#!/usr/bin/env node
/**
 * Applies lib/db/migrations/*.sql in filename order, once each.
 *
 * Plain ESM on purpose: it runs straight from the source mount with no build
 * step, so `docker compose up` can migrate a fresh database before the API
 * starts. The SQL is the ported version of the Supabase migrations (see
 * scripts/port-supabase-schema.mjs) plus the first-party auth tables.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  await pool.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await pool.query("select name from schema_migrations")).rows.map((row) => row.name),
  );

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`[migrate] applied ${file}`);
      count += 1;
    } catch (error) {
      await client.query("rollback");
      console.error(`[migrate] ${file} failed: ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(`[migrate] ${count} applied, ${files.length} total`);
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => {});
    process.exit(1);
  });
