import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, requireConfig } from "./config";

let cached: SupabaseClient | null = null;

export function createServiceSupabaseClient(): SupabaseClient {
  if (cached) return cached;
  const serviceRoleKey = requireConfig(process.env.SUPABASE_SERVICE_ROLE_KEY || "", "SUPABASE_SERVICE_ROLE_KEY");
  cached = createClient(config.supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cached;
}
