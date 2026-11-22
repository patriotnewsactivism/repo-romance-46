#!/usr/bin/env node
/**
 * Port the historical Supabase migrations into portable Postgres DDL.
 *
 * The Supabase project was Auth + Postgres + RLS + Vault. Moving to a
 * self-hosted Postgres keeps the schema and drops the parts that only exist
 * inside Supabase's platform:
 *
 *   - `auth.users` foreign keys   -> `app_users` (first-party auth tables)
 *   - RLS policies                -> removed; the API is the security boundary
 *                                    and scopes every user-owned table by
 *                                    user_id (see lib/db/src/client.ts)
 *   - Vault RPCs                  -> removed; secrets are encrypted with
 *                                    SECRET_ENCRYPTION_KEY in app code
 *
 * Run from the repo root:  node scripts/port-supabase-schema.mjs
 * Output is committed to lib/db/migrations so a fresh database can be built
 * without touching Supabase.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SRC = "supabase/migrations";
const OUT = "lib/db/migrations";

/**
 * Hand-written migrations (0000_*, 0002_*, 9999_*) share this directory and are
 * never touched by this script; it only overwrites the ported files.
 */

/** Split SQL into statements while respecting quotes, comments and $$ bodies. */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      buf += ch;
      if (ch === "\n") inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        buf += "*/";
        i += 2;
        inBlockComment = false;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }
    if (inSingle) {
      if (ch === "'" && next === "'") {
        buf += "''";
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      buf += ch;
      i += 1;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === "-" && next === "-") {
      inLineComment = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === "$") {
      const match = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        buf += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ";") {
      out.push(`${buf};`);
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }

  if (buf.trim()) out.push(buf);
  return out;
}

/** Statements that only make sense inside Supabase. */
function isPlatformOnly(statement) {
  const body = statement
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();

  if (!body || body === ";") return true;

  const dropped = [
    /^alter\s+table\s+[\s\S]*?enable\s+row\s+level\s+security/i,
    /^alter\s+table\s+[\s\S]*?force\s+row\s+level\s+security/i,
    /^create\s+policy/i,
    /^drop\s+policy/i,
    /^alter\s+policy/i,
    /^comment\s+on\s+policy/i,
    /^grant\s/i,
    /^revoke\s/i,
    /^alter\s+default\s+privileges/i,
    /^create\s+publication/i,
    /^alter\s+publication/i,
    /^create\s+extension[^;]*supabase_vault/i,
    /^create\s+extension[^;]*pg_net/i,
  ];
  if (dropped.some((pattern) => pattern.test(body))) return true;

  // Anything that still reaches for Supabase's auth or Vault at runtime.
  if (/auth\.uid\s*\(/i.test(body)) return true;
  if (/\bvault\./i.test(body)) return true;
  if (/supabase_vault/i.test(body)) return true;
  if (/net\.http_/i.test(body)) return true;

  return false;
}

function rewrite(statement) {
  return statement
    .replace(/references\s+auth\.users\s*\(\s*id\s*\)/gi, "references app_users (id)")
    .replace(/references\s+public\.auth\.users\s*\(\s*id\s*\)/gi, "references app_users (id)")
    .replace(/\bauth\.users\s*\(\s*id\s*\)/gi, "app_users (id)");
}

const files = (await readdir(SRC)).filter((f) => f.endsWith(".sql")).sort();
await mkdir(OUT, { recursive: true });

let kept = 0;
let removed = 0;
const report = [];

for (const file of files) {
  const sql = await readFile(path.join(SRC, file), "utf8");
  const statements = splitStatements(sql);
  const output = [];

  for (const statement of statements) {
    if (isPlatformOnly(statement)) {
      removed += 1;
      continue;
    }
    kept += 1;
    output.push(rewrite(statement));
  }

  const body = output.join("\n").trim();
  if (!body) continue;

  const header = `-- Ported from supabase/migrations/${file}\n-- Supabase platform statements (RLS policies, auth.users FKs, Vault RPCs) removed.\n\n`;
  await writeFile(path.join(OUT, file), header + body + "\n", "utf8");
  report.push(`${file}: ${output.length} statements`);
}

console.log(`kept ${kept} statements, dropped ${removed} platform-only statements`);
console.log(report.join("\n"));
