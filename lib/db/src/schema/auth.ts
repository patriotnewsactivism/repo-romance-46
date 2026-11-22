import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * First-party identity. Replaces Supabase Auth; see lib/db/migrations/0000_app_auth.sql
 * for the authoritative DDL.
 */
export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email"),
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    githubUserId: text("github_user_id"),
    githubLogin: text("github_login"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("app_users_github_idx").on(table.githubUserId),
    index("app_users_email_idx").on(table.email),
  ],
);

export const appSessions = pgTable(
  "app_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
  },
  (table) => [index("app_sessions_user_idx").on(table.userId)],
);

export type AppUser = typeof appUsers.$inferSelect;
export type AppSession = typeof appSessions.$inferSelect;
