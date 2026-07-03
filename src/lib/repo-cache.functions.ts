import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface CachedRepo {
  github_repo_id: number;
  full_name: string;
  repo_data: Record<string, unknown>;
  readme_text: string | null;
  file_tree: string[] | null;
  fetched_at: string;
}

export const getCachedRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("repo_cache")
      .select("github_repo_id, full_name, repo_data, readme_text, file_tree, fetched_at")
      .eq("user_id", context.userId)
      .gt("expires_at", new Date().toISOString());

    if (error) throw new Error(error.message);
    return (data || []) as CachedRepo[];
  });

export const clearRepoCache = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("repo_cache")
      .delete()
      .eq("user_id", context.userId);

    if (error) throw new Error(error.message);
    return { cleared: true };
  });

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
