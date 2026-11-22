import { drizzle } from "drizzle-orm/node-postgres";
import { getPool } from "./pool";
import * as schema from "./schema";

/**
 * Shared connection pool. Throws on import when DATABASE_URL is unset so a
 * misconfigured deploy fails at boot instead of on the first query.
 */
export const pool = getPool();
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./client";
export * from "./auth-crypto";
export { getPool } from "./pool";
