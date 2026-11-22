import { createServiceClient, type SupabaseClient } from "@workspace/db";

let cached: SupabaseClient | null = null;

/**
 * Unrestricted data client for trusted server code.
 *
 * This is the equivalent of the old Supabase service-role client: it is not
 * scoped to a user, so every query that uses it must constrain ownership
 * itself. Request-scoped work should use `req.supabase` instead, which the
 * auth middleware binds to the signed-in user.
 */
export function createServiceSupabaseClient(): SupabaseClient {
  if (!cached) cached = createServiceClient();
  return cached;
}
