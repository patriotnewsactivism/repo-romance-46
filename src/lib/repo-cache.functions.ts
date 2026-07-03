import { createServerFn } from "@tanstack/react-start";
import { getSupabaseServerClient } from "@/lib/supabase";

/**
 * Repo cache — stores GitHub repo data for 24h to speed up re-analyses.
 * Before fetching from GitHub, check the cache. After fetching, store it.
 */

interface CachedRepo {
  github_repo_id: number;
  full_name: string;
  repo_data: Record<string, unknown>;
  readme_text: string | null;
  file_tree: string[] | null;
  fetched_at: string;
}

// Get cached repos for a user (only fresh ones, < 24h old)
export const getCachedRepos = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("repo_cache")
    .select("github_repo_id, full_name, repo_data, readme_text, file_tree, fetched_at")
    .eq("user_id", user.id)
    .gt("expires_at", new Date().toISOString());

  if (error) throw new Error(error.message);
  return (data || []) as CachedRepo[];
});

// Clear the cache for the current user
export const clearRepoCache = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("repo_cache").delete().eq("user_id", user.id);

  if (error) throw new Error(error.message);
  return { cleared: true };
});

// Prune expired cache entries (can be called by the cron job)
export const pruneExpiredCache = createServerFn({ method: "POST" }).handler(async ({ request }) => {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return { error: "Unauthorized" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { error: "Not configured" };

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey);

  const { data, error } = await admin
    .from("repo_cache")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) return { error: error.message };
  return { pruned: data?.length || 0 };
});
