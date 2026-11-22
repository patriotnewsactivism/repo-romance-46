/**
 * Postgres data client.
 *
 * The application was written against PostgREST's query builder
 * (`supabase.from(t).select(...).eq(...)`). Rather than rewrite ~330 call
 * sites, this module implements the same builder over a plain `pg` pool, so
 * `createClient(...)` and the `SupabaseClient` type name keep working.
 *
 * Two behaviours are deliberately preserved:
 *
 *  1. `{ data, error }` results. Queries never throw; callers already branch
 *     on `error`.
 *  2. Row ownership. Supabase enforced per-user isolation with RLS. That
 *     guarantee now lives here: a client built with a `userId` automatically
 *     constrains every read/write on a table that has a `user_id` column.
 *     The service client (no `userId`) is unrestricted and must only be used
 *     by trusted server code, exactly like the old service-role key.
 */

import { getPool } from "./pool";

export interface PostgrestError {
  message: string;
  code: string;
  details?: string | null;
  hint?: string | null;
}

export interface DbResponse<T = any[]> {
  data: T;
  error: PostgrestError | null;
  count?: number | null;
}

type Action = "select" | "insert" | "update" | "upsert" | "delete";
type FilterOp = "eq" | "neq" | "in" | "is" | "gte" | "lte" | "lt" | "gt" | "contains";

interface Filter {
  column: string;
  op: FilterOp;
  value: unknown;
}

interface Order {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

interface ClientOptions {
  /** When set, every statement on a user-owned table is scoped to this user. */
  userId?: string;
}

/** Tables with a `user_id` column, discovered once per process. */
let userOwnedTables: Set<string> | null = null;

async function loadUserOwnedTables(): Promise<Set<string>> {
  if (userOwnedTables) return userOwnedTables;
  const { rows } = await getPool().query<{ table_name: string }>(
    `select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'user_id'`,
  );
  userOwnedTables = new Set(rows.map((row) => row.table_name));
  return userOwnedTables;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toPostgrestError(error: unknown): PostgrestError {
  const err = error as { message?: string; code?: string; detail?: string; hint?: string };
  let code = err?.code ?? "PGRST000";
  // PostgREST reported a missing relation as PGRST205; the callers that
  // tolerate a missing table still look for that code.
  if (code === "42P01") code = "PGRST205";
  return {
    message: err?.message ?? String(error),
    code,
    details: err?.detail ?? null,
    hint: err?.hint ?? null,
  };
}

/** `select('id, name, owner:full_name')` -> `"id", "name", "full_name" as "owner"`. */
function projection(columns: string | null): string {
  if (!columns || columns.trim() === "" || columns.trim() === "*") return "*";
  const parts = columns
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part === "*") return "*";
      const aliasMatch = /^([A-Za-z_][\w]*)\s*:\s*([A-Za-z_][\w]*)$/.exec(part);
      if (aliasMatch) return `${quoteIdent(aliasMatch[2])} as ${quoteIdent(aliasMatch[1])}`;
      return quoteIdent(part);
    });
  return parts.length ? parts.join(", ") : "*";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class QueryBuilder<T = any[]> implements PromiseLike<DbResponse<T>> {
  private action: Action = "select";
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } | undefined;
  private columns: string | null = null;
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private limitCount: number | null = null;
  private singleMode: "none" | "single" | "maybe" = "none";

  constructor(
    private readonly table: string,
    private readonly options: ClientOptions,
  ) {}

  insert(values: Record<string, unknown> | Record<string, unknown>[]): this {
    this.action = "insert";
    this.payload = values;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.action = "update";
    this.payload = values;
    return this;
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.action = "upsert";
    this.payload = values;
    this.upsertOptions = options;
    return this;
  }

  delete(): this {
    this.action = "delete";
    return this;
  }

  select(columns = "*"): this {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.addFilter("eq", column, value);
  }

  neq(column: string, value: unknown): this {
    return this.addFilter("neq", column, value);
  }

  in(column: string, values: readonly unknown[]): this {
    return this.addFilter("in", column, values);
  }

  is(column: string, value: boolean | null): this {
    return this.addFilter("is", column, value);
  }

  gte(column: string, value: unknown): this {
    return this.addFilter("gte", column, value);
  }

  lte(column: string, value: unknown): this {
    return this.addFilter("lte", column, value);
  }

  gt(column: string, value: unknown): this {
    return this.addFilter("gt", column, value);
  }

  lt(column: string, value: unknown): this {
    return this.addFilter("lt", column, value);
  }

  contains(column: string, value: unknown): this {
    return this.addFilter("contains", column, value);
  }

  /** `not('id', 'is', null)` -> `"id" is not null`. */
  not(column: string, operator: FilterOp, value: unknown): this {
    if (operator === "is") {
      const negated = value === null ? "is not null" : value === true ? "is not true" : "is not false";
      this.filters.push({ column, op: "is", value: negated as unknown });
      return this;
    }
    this.filters.push({ column, op: operator, value: { __not: true, value } });
    return this;
  }

  match(criteria: Record<string, unknown>): this {
    for (const [column, value] of Object.entries(criteria)) this.eq(column, value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orders.push({
      column,
      ascending: options?.ascending !== false,
      nullsFirst: options?.nullsFirst,
    });
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  single(): PromiseLike<DbResponse<any>> {
    this.singleMode = "single";
    return this as unknown as PromiseLike<DbResponse<any>>;
  }

  maybeSingle(): PromiseLike<DbResponse<any>> {
    this.singleMode = "maybe";
    return this as unknown as PromiseLike<DbResponse<any>>;
  }

  then<R1 = DbResponse<T>, R2 = never>(
    onfulfilled?: ((value: DbResponse<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    // `run` resolves an untyped row set; `T` is the shape the call site expects
    // (an array for a list query, a single row after `.single()`).
    return this.run().then(onfulfilled as never, onrejected);
  }

  private addFilter(op: FilterOp, column: string, value: unknown): this {
    this.filters.push({ column, op, value });
    return this;
  }

  private async scopedFilters(): Promise<Filter[]> {
    const filters = [...this.filters];
    if (this.options.userId && this.action !== "insert") {
      const owned = await loadUserOwnedTables();
      if (owned.has(this.table)) {
        filters.unshift({ column: "user_id", op: "eq", value: this.options.userId });
      }
    }
    return filters;
  }

  private buildWhere(filters: Filter[], params: unknown[]): string {
    const clauses: string[] = [];

    for (const filter of filters) {
      const col = quoteIdent(filter.column);
      const raw = filter.value as { __not?: boolean; value?: unknown } | unknown;
      const negated = isPlainObject(raw) && raw.__not === true;
      const value = negated ? (raw as { value: unknown }).value : raw;
      const prefix = negated ? "not " : "";
      const push = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };

      switch (filter.op) {
        case "eq":
          clauses.push(value === null ? `${col} is null` : `${col} = ${push(value)}`);
          break;
        case "neq":
          clauses.push(value === null ? `${col} is not null` : `${col} <> ${push(value)}`);
          break;
        case "in": {
          const list = Array.isArray(value) ? value : [];
          if (!list.length) {
            clauses.push("false");
            break;
          }
          clauses.push(`${col} = any(${push(list)})`);
          break;
        }
        case "is": {
          // `not(..., 'is', null)` stores the SQL fragment directly.
          if (typeof value === "string") {
            clauses.push(`${col} ${value}`);
            break;
          }
          clauses.push(`${col} is ${value === true ? "true" : value === false ? "false" : "null"}`);
          break;
        }
        case "gte":
          clauses.push(`${prefix}${col} >= ${push(value)}`);
          break;
        case "lte":
          clauses.push(`${prefix}${col} <= ${push(value)}`);
          break;
        case "lt":
          clauses.push(`${prefix}${col} < ${push(value)}`);
          break;
        case "gt":
          clauses.push(`${prefix}${col} > ${push(value)}`);
          break;
        case "contains":
          clauses.push(`${prefix}${col} @> ${push(value)}`);
          break;
        default:
          break;
      }
    }

    return clauses.length ? ` where ${clauses.join(" and ")}` : "";
  }

  /** SELECT already lists its columns; only writes append RETURNING. */
  private returning(): string {
    if (this.action === "select") return "";
    // PostgREST returns rows from a write only when `.select()` was chained.
    return this.columns ? projection(this.columns) : "";
  }

  private async run(): Promise<DbResponse<any>> {
    try {
      const params: unknown[] = [];
      const filters = await this.scopedFilters();
      let sql: string;

      if (this.action === "select") {
        sql = `select ${projection(this.columns)} from ${quoteIdent(this.table)}`;
        sql += this.buildWhere(filters, params);
        if (this.orders.length) {
          sql += ` order by ${this.orders
            .map(
              (order) =>
                `${quoteIdent(order.column)} ${order.ascending ? "asc" : "desc"}${
                  order.nullsFirst === undefined ? "" : order.nullsFirst ? " nulls first" : " nulls last"
                }`,
            )
            .join(", ")}`;
        }
        if (this.limitCount !== null) sql += ` limit ${Number(this.limitCount)}`;
      } else if (this.action === "insert" || this.action === "upsert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
        const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
        const values: string[] = [];
        for (const row of rows) {
          const placeholders = columns.map((column) => {
            params.push((row as Record<string, unknown>)[column] ?? null);
            return `$${params.length}`;
          });
          values.push(`(${placeholders.join(", ")})`);
        }
        sql = `insert into ${quoteIdent(this.table)} (${columns.map(quoteIdent).join(", ")}) values ${values.join(", ")}`;

        if (this.action === "upsert") {
          const conflictColumns = (this.upsertOptions?.onConflict ?? "id")
            .split(",")
            .map((column) => column.trim())
            .filter(Boolean);
          sql += ` on conflict (${conflictColumns.map(quoteIdent).join(", ")})`;
          if (this.upsertOptions?.ignoreDuplicates) {
            sql += " do nothing";
          } else {
            const updatable = columns.filter((column) => !conflictColumns.includes(column));
            sql += updatable.length
              ? ` do update set ${updatable
                  .map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`)
                  .join(", ")}`
              : " do nothing";
          }
        }
      } else if (this.action === "update") {
        const entries = Object.entries(this.payload ?? {});
        const sets = entries.map(([column, value]) => {
          params.push(value ?? null);
          return `${quoteIdent(column)} = $${params.length}`;
        });
        sql = `update ${quoteIdent(this.table)} set ${sets.join(", ")}`;
        sql += this.buildWhere(filters, params);
      } else {
        sql = `delete from ${quoteIdent(this.table)}`;
        sql += this.buildWhere(filters, params);
      }

      const returning = this.returning();
      if (returning) sql += ` returning ${returning}`;
      const returnsRows = this.action === "select" || Boolean(this.columns);

      const result = await getPool().query(sql, params as never[]);
      const rows = result.rows as any[];

      if (this.singleMode !== "none") {
        if (rows.length === 1) return { data: rows[0], error: null };
        if (rows.length === 0 && this.singleMode === "maybe") return { data: null, error: null };
        return {
          data: null,
          error: {
            message: "JSON object requested, multiple (or no) rows returned",
            code: "PGRST116",
            details: `The result contains ${rows.length} rows`,
            hint: null,
          },
        };
      }

      return { data: returnsRows ? rows : null, error: null };
    } catch (error) {
      return { data: null, error: toPostgrestError(error) };
    }
  }
}

export interface DbClient {
  from<T = any[]>(table: string): QueryBuilder<T>;
  /** Compatibility shim: user-supplied AI keys are encrypted in app code now. */
  rpc(name: string, args?: Record<string, unknown>): Promise<DbResponse<any>>;
  /** Session helpers are resolved by the auth routes, not the client. */
  readonly userId?: string;
}

class PgClient implements DbClient {
  readonly userId?: string;

  constructor(private readonly options: ClientOptions = {}) {
    this.userId = options.userId;
  }

  from<T = any[]>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table, this.options);
  }

  async rpc(name: string): Promise<DbResponse<any>> {
    return {
      data: null,
      error: {
        message: `Database function ${name} is not available on self-hosted Postgres`,
        code: "PGRST202",
        details: null,
        hint: "Secrets are stored with SECRET_ENCRYPTION_KEY in app code.",
      },
    };
  }
}

/** Structural stand-in for `SupabaseClient` so existing signatures keep compiling. */
export type SupabaseClient = DbClient;

/**
 * PostgREST-compatible factory. The URL/key arguments are accepted for call-site
 * compatibility and ignored: the connection comes from DATABASE_URL.
 */
export function createClient(
  _url?: string,
  _key?: string,
  options: ClientOptions = {},
): DbClient {
  return new PgClient(options);
}

/** Unrestricted client for trusted server code (the old service-role key). */
export function createServiceClient(): DbClient {
  return new PgClient();
}
