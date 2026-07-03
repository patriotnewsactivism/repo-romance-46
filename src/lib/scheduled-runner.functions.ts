import { createServerFn } from "@tanstack/react-start";
import { callAI } from "@/lib/ai-provider";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Scheduled analysis runner.
 *
 * Called by a cron trigger (Cloudflare Cron / Vercel Cron / external scheduler).
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
  // Auth: verify CRON_SECRET
  const authHeader = request?.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return { error: "CRON_SECRET not configured", ran: 0 };
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return { error: "Unauthorized", ran: 0 };
  }

  // Use service role to query all users with scheduling enabled
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

  if (error) {
    return { error: error.message, ran: 0 };
  }

  if (!users || users.length === 0) {
    return { message: "No users with scheduling enabled", ran: 0 };
  }

  // Filter to users who are due for a run
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

      // Create a new analysis record
      const { data: analysis, error: aErr } = await admin
        .from("analyses")
        .insert({ user_id: user.user_id, status: "running" })
        .select("id")
        .single();

      if (aErr || !analysis) {
        results.push({ user: user.user_id, status: "error", error: aErr?.message });
        continue;
      }

      const analysisId = analysis.id;

      try {
        // Fetch repos from GitHub
        const ghRes = await fetch(
          "https://api.github.com/user/repos?per_page=100&affiliation=owner&sort=pushed",
          {
            headers: {
              Authorization: `Bearer ${conn.access_token}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "repo-finisher",
            },
          },
        );
        if (!ghRes.ok) throw new Error(`GitHub API error: ${ghRes.status}`);
        const repos = (await ghRes.json()) as Array<{
          full_name: string;
          name: string;
          description: string | null;
          language: string | null;
          stargazers_count: number;
          forks_count: number;
          archived: boolean;
          fork: boolean;
          pushed_at: string;
          default_branch: string;
          html_url: string;
          topics: string[];
          size: number;
          homepage: string | null;
          license: { name: string } | null;
        }>;

        // Apply filters from preferences
        let shortlist = repos.filter((r) => !r.fork);

        // Get filter prefs
        const { data: filterPrefs } = await admin
          .from("user_preferences")
          .select("filter_languages, filter_exclude_archived, filter_min_stars, filter_max_repos")
          .eq("user_id", user.user_id)
          .maybeSingle();

        if (filterPrefs) {
          const fp = filterPrefs as {
            filter_languages: string[] | null;
            filter_exclude_archived: boolean;
            filter_min_stars: number;
            filter_max_repos: number | null;
          };
          if (fp.filter_exclude_archived) shortlist = shortlist.filter((r) => !r.archived);
          if (fp.filter_languages && fp.filter_languages.length > 0)
            shortlist = shortlist.filter(
              (r) => r.language && fp.filter_languages!.includes(r.language),
            );
          if (fp.filter_min_stars > 0)
            shortlist = shortlist.filter((r) => r.stargazers_count >= fp.filter_min_stars);
        }
        shortlist = shortlist.slice(
          0,
          (filterPrefs as { filter_max_repos?: number } | null)?.filter_max_repos || 25,
        );

        if (shortlist.length < 2) {
          await admin
            .from("analyses")
            .update({ status: "failed", error: "Need at least 2 active repos" })
            .eq("id", analysisId);
          results.push({ user: user.user_id, status: "skipped", error: "Not enough repos" });
          continue;
        }

        // Build digests
        const digests: string[] = [];
        for (const repo of shortlist) {
          try {
            // Fetch README
            const readmeRes = await fetch(`https://api.github.com/repos/${repo.full_name}/readme`, {
              headers: {
                Authorization: `Bearer ${conn.access_token}`,
                Accept: "application/vnd.github.raw",
                "User-Agent": "repo-finisher",
              },
            });
            const readme = readmeRes.ok ? await readmeRes.text() : "(no README)";

            // Fetch file tree
            const treeRes = await fetch(
              `https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`,
              {
                headers: {
                  Authorization: `Bearer ${conn.access_token}`,
                  Accept: "application/vnd.github+json",
                  "User-Agent": "repo-finisher",
                },
              },
            );
            const treeJson = treeRes.ok
              ? ((await treeRes.json()) as { tree: { path: string; type: string }[] })
              : { tree: [] };
            const files = treeJson.tree
              .filter((t) => t.type === "blob")
              .map((t) => t.path)
              .slice(0, 50)
              .join(", ");

            digests.push(
              `## ${repo.full_name}
- Language: ${repo.language || "unknown"}
- Stars: ${repo.stargazers_count} | Forks: ${repo.forks_count}
- Last push: ${repo.pushed_at}
- Topics: ${repo.topics?.join(", ") || "none"}
- License: ${repo.license?.name || "none"}
- Homepage: ${repo.homepage || "none"}
- Size: ${repo.size}KB

### README (first 2000 chars):
${readme.slice(0, 2000)}

### Files (first 50):
${files}`,
            );
          } catch {
            // skip this repo
          }
        }

        // Call AI via centralized provider router — supports all providers
        // (OpenAI, Anthropic, Google, GitHub Models, Lovable fallback)
        let aiKey = user.custom_ai_key || null;
        if (user.custom_ai_provider === "github_models" && !aiKey) {
          aiKey = conn.access_token; // reuse GitHub OAuth token
        }
        const aiResponse = await callAI(
          {
            messages: [
              {
                role: "system",
                content: `You are a senior product strategist. Given GitHub repos, produce 5-10 ranked recommendations (kind: finish/combine/repurpose). Each: title, repos, pitch, next_steps, effort (1-5), market_potential (1-5), tech_stack, marketing_tweet, marketing_linkedin, estimated_hours. Also: summary_md. Return JSON.`,
              },
              { role: "user", content: `Repos:\n\n${digests.join("\n\n---\n\n")}` },
            ],
          },
          { provider: user.custom_ai_provider || "lovable", apiKey: aiKey },
        );
        const aiResult = JSON.parse(aiResponse.content || "{}") as {
          recommendations: Array<Record<string, unknown>>;
          summary_md: string;
          portfolio_stats: Record<string, unknown>;
        };

        // Sort recommendations
        const ranked = [...(aiResult.recommendations || [])].sort(
          (a, b) =>
            (b.market_potential as number) * 2 -
            (b.effort as number) -
            ((a.market_potential as number) * 2 - (a.effort as number)),
        );

        // Insert analysis items
        const rows = ranked.map((r, i) => ({
          analysis_id: analysisId,
          user_id: user.user_id,
          kind: r.kind,
          title: r.title,
          repos: r.repos,
          pitch: r.pitch,
          effort: Math.max(1, Math.min(5, r.effort as number)),
          market_potential: Math.max(1, Math.min(5, r.market_potential as number)),
          next_steps: r.next_steps,
          tech_stack: r.tech_stack ?? [],
          marketing_tweet: r.marketing_tweet ?? null,
          marketing_linkedin: r.marketing_linkedin ?? null,
          estimated_hours: r.estimated_hours ?? null,
          rank: i,
        }));

        if (rows.length > 0) {
          await admin.from("analysis_items").insert(rows);
        }

        // Update analysis as complete
        await admin
          .from("analyses")
          .update({
            status: "complete",
            repo_count: shortlist.length,
            analyzed_repo_names: shortlist.map((r) => r.full_name),
            summary_md: aiResult.summary_md,
            portfolio_stats: aiResult.portfolio_stats || {},
            completed_at: new Date().toISOString(),
          })
          .eq("id", analysisId);

        // Update last_scheduled_run
        await admin
          .from("user_preferences")
          .update({
            last_scheduled_run: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.user_id);

        // Send email notification if enabled
        if (user.email_notifications) {
          try {
            const { data: userData } = await admin.auth.admin.getUserById(user.user_id);
            const email = userData.user?.email;
            if (email) {
              const resendKey = process.env.RESEND_API_KEY;
              if (resendKey) {
                const appUrl = process.env.APP_URL || "https://repofinish.vercel.app";
                await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${resendKey}`,
                  },
                  body: JSON.stringify({
                    from: "repo_finisher <noreply@donmatthews.live>",
                    to: email,
                    subject: `Portfolio analysis complete — ${shortlist.length} repos scanned`,
                    html: `
                        <h2>Your scheduled analysis is ready</h2>
                        <p>We scanned ${shortlist.length} of your GitHub repos and generated ${ranked.length} recommendations.</p>
                        <p><a href="${appUrl}/analysis/${analysisId}">View your analysis →</a></p>
                        <hr>
                        <p style="color:#666;font-size:12px">This is an automated message from repo_finisher. Manage notifications in <a href="${appUrl}/settings">Settings</a>.</p>
                      `,
                  }),
                });
                console.log(`[scheduled] Email sent to ${email}`);
                // Log the notification
                await admin.from("notification_log").insert({
                  user_id: user.user_id,
                  analysis_id: analysisId,
                  type: "email",
                  recipient: email,
                  subject: `Portfolio analysis complete — ${shortlist.length} repos scanned`,
                  status: "sent",
                });
              } else {
                console.log(
                  `[scheduled] Email notification skipped (RESEND_API_KEY not set) for ${email}`,
                );
              }
            }
          } catch (e) {
            console.error("[scheduled] Failed to send email:", e);
          }
        }

        ran++;
        results.push({ user: user.user_id, status: "complete", analysisId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Analysis failed";
        await admin.from("analyses").update({ status: "failed", error: msg }).eq("id", analysisId);
        results.push({ user: user.user_id, status: "error", error: msg });
      }
    } catch (e) {
      results.push({
        user: user.user_id,
        status: "error",
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }

    // Small delay between users to avoid rate limits
    await new Promise((r) => setTimeout(r, 2000));
  }

  return {
    totalUsers: users.length,
    dueUsers: dueUsers.length,
    ran,
    results,
  };
});

// Export a standalone email notification function for manual analyses
export const sendAnalysisEmail = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  const authHeader = request?.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return { error: "Unauthorized" };
  }

  const body = (await request!.json()) as {
    email: string;
    analysisId: string;
    repoCount: number;
    recCount: number;
  };
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { error: "RESEND_API_KEY not set" };

  const appUrl = process.env.APP_URL || "https://repofinish.vercel.app";
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: "repo_finisher <noreply@donmatthews.live>",
      to: body.email,
      subject: `Portfolio analysis complete — ${body.repoCount} repos scanned`,
      html: `
          <h2>Your analysis is ready</h2>
          <p>We scanned ${body.repoCount} of your GitHub repos and generated ${body.recCount} recommendations.</p>
          <p><a href="${appUrl}/analysis/${body.analysisId}">View your analysis →</a></p>
        `,
    }),
  });

  return { ok: true };
});
