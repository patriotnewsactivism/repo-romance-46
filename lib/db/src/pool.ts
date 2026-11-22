import pg from "pg";

const { Pool } = pg;

/**
 * One connection pool per process. The API, the worker and the migration
 * runner all share it; `pg` handles the concurrency.
 */
function createPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL must be set. Point it at the Postgres service in docker-compose.base44.yml.",
    );
  }
  return new Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

let cached: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!cached) cached = createPool();
  return cached;
}

export type { Pool };
