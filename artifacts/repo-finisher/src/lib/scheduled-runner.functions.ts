import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { executeAnalysis, type AnalysisContext } from "@/lib/analysis.functions";

/**
 * Scheduled analysis runner.
 *
 * Called by a cron trigger (Vercel Cron / external scheduler).
 * Finds all users with schedule_enabled=true whose last_scheduled_run is old
 * enough based on their frequency, and runs a fresh analysis for them.
 *
 * Auth: protected by a CRON_SECRET env var (passed as Bearer token).
 */

interface ScheduledUser {
  user_id: string;
  schedule_frequency: "weekly" | "monthly";
  last_scheduled_run: string | null;
  email_notifications: boolean;
  custom_ai_provider: string;
  custom_ai_key: string | null;
}

function shouldRun(frequency: "weekly" | "monthly", lastRun: string | null): boolean {
  if (!lastRun) return true;
  const last = new Date(lastRun).getTime();
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  return now - last > (frequency === "weekly" ? weekMs : monthMs);
}

export const runScheduledAnalyses = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const authHeader = request?.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return { error: "CRON_SECRET not configured", ran: 0 };
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return { error: "Unauthorized", ran: 0 };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return { error: "Supabase not configured", ran: 0 };
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey);

  // Get all users with scheduling enabled
  const { data: users, error } = await admin
    .from("user_preferences")
    .select(
      "user_id, schedule_frequency, last_scheduled_run, email_notifications, custom_ai_provider, custom_ai_key",
    )
    .eq("schedule_enabled", true);

  if (error) return { error: error.message, ran: 0 };
  if (!users || users.length === 0) {
    return { message: "No users with scheduling enabled", ran: 0 };
  }

  const dueUsers = (users as ScheduledUser[]).filter((u) =>
    shouldRun(u.schedule_frequency, u.last_scheduled_run),
  );

  if (dueUsers.length === 0) {
    return { message: "No users due for scheduled analysis", ran: 0 };
  }

  let ran = 0;
  const results: { user: string; status: string; analysisId?: string; error?: string }[] = [];

  for (const user of dueUsers) {
    try {
      // Get the user's GitHub connection
      const { data: conn, error: connErr } = await admin
        .from("github_connections")
        .select("access_token, github_login")
        .eq("user_id", user.user_id)
        .maybeSingle();

      if (connErr || !conn) {
        results.push({ user: user.user_id, status: "skipped", error: "No GitHub connection" });
        continue;
      }

      // Get full prefs (including filters)
      const { data: prefs } = await admin
        .from("user_preferences")
        .select(
          "custom_ai_provider, custom_ai_key, filter_max_repos, filter_languages, filter_min_stars, filter_exclude_archived",
        )
        .eq("user_id", user.user_id)
        .maybeSingle();

      // Build context using the service-role admin client
      const ctx: AnalysisContext = {
        supabase: admin,
        userId: user.user_id,
        token: conn.access_token,
        prefs: prefs as AnalysisContext["prefs"],
        triggerType: "scheduled",
        onProgress: async () => {}, // no-op for scheduled runs
      };

      const result = await executeAnalysis(ctx);
      ran++;

      // Update last_scheduled_run
      await admin
        .from("user_preferences")
        .update({ last_scheduled_run: new Date().toISOString() })
        .eq("user_id", user.user_id);

      results.push({ user: user.user_id, status: "ok", analysisId: result.id });

      // Send email notification if enabled
      if (user.email_notifications) {
        try {
          const { data: analysis } = await admin
            .from("analyses")
            .select("summary_md, repo_count")
            .eq("id", result.id)
            .maybeSingle();

          // Fetch user email from auth
          const { data: authUser } = await admin.auth.admin.getUserById(user.user_id);
          const email = authUser?.user?.email;

          if (email && analysis) {
            // Send via Supabase edge function or external email service
            // For now, log — wire up your email provider here
            console.log(`[scheduled] Email notification for ${email}: analysis ${result.id} complete (${analysis.repo_count} repos)`);
          }
        } catch (emailErr) {
          console.warn("[scheduled] Failed to send email notification:", emailErr);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      results.push({ user: user.user_id, status: "error", error: msg });
    }
  }

  return { ran, results };
});
