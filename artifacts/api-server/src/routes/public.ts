import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { parseState } from "../lib/github-state";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const router: IRouter = Router();

// GitHub OAuth callback — public, redirects back to the frontend dashboard.
router.get(
  "/public/github/callback",
  asyncHandler(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const host = (req.headers["x-forwarded-host"] as string) ?? req.headers.host ?? "";
    const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
    const origin = process.env.APP_ORIGIN ?? (host ? `${proto}://${host}` : "");

    const redirect = (path: string) => res.redirect(302, `${origin}${path}`);

    if (!code || !state) return redirect("/dashboard?gh_error=missing_code");

    const userId = parseState(state);
    if (!userId) return redirect("/dashboard?gh_error=bad_state");

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) return redirect("/dashboard?gh_error=not_configured");

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${origin}/api/public/github/callback`,
      }),
    });
    if (!tokenRes.ok) return redirect("/dashboard?gh_error=token_exchange_failed");
    const tokenJson = (await tokenRes.json()) as { access_token?: string; scope?: string; error?: string };
    if (!tokenJson.access_token) return redirect(`/dashboard?gh_error=${tokenJson.error ?? "no_token"}`);

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "repo-finisher",
      },
    });
    const userJson = (await userRes.json()) as { login?: string };
    const login = userJson.login ?? "unknown";

    const { error } = await getSupabaseAdmin()
      .from("github_connections")
      .upsert(
        {
          user_id: userId,
          github_login: login,
          access_token: tokenJson.access_token,
          scope: tokenJson.scope ?? null,
          connected_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) return redirect(`/dashboard?gh_error=db_${encodeURIComponent(error.message)}`);

    return redirect("/dashboard?gh=connected");
  }),
);

// Public shared analysis view — no auth required, uses anon key over REST.
router.get(
  "/public/analysis/:slug",
  asyncHandler(async (req, res) => {
    const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error("Server is not configured for Supabase access.");

    const analysisRes = await fetch(
      `${supabaseUrl}/rest/v1/analyses?select=*&share_slug=eq.${encodeURIComponent(slug)}&is_public=eq.true`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
    );
    if (!analysisRes.ok) throw new Error("Failed to fetch analysis");
    const analyses = (await analysisRes.json()) as any[];
    if (!analyses || analyses.length === 0) {
      throw Object.assign(new Error("Analysis not found or no longer shared."), { status: 404 });
    }
    const analysis = analyses[0];

    if (analysis.share_expires_at) {
      const expires = new Date(analysis.share_expires_at).getTime();
      if (Date.now() > expires) {
        throw Object.assign(new Error("This shared analysis has expired."), { status: 410 });
      }
    }

    const itemsRes = await fetch(
      `${supabaseUrl}/rest/v1/analysis_items?select=*&analysis_id=eq.${encodeURIComponent(analysis.id)}&order=rank.asc`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
    );
    if (!itemsRes.ok) throw new Error("Failed to fetch analysis items");
    const items = await itemsRes.json();

    res.json({ analysis, items: items ?? [] });
  }),
);

export default router;
