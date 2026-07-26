import { createFileRoute } from "@tanstack/react-router";
import { parseState } from "@/lib/github.functions";

export const Route = createFileRoute("/api/public/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const origin = process.env.APP_ORIGIN ?? url.origin;

        if (!code || !state) {
          return redirectTo(`${origin}/dashboard?gh_error=missing_code`);
        }

        const userId = parseState(state);
        if (!userId) return redirectTo(`${origin}/dashboard?gh_error=bad_state`);

        const clientId = process.env.GITHUB_CLIENT_ID;
        const clientSecret = process.env.GITHUB_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          return redirectTo(`${origin}/dashboard?gh_error=not_configured`);
        }

        // Exchange code for token
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
        if (!tokenRes.ok) {
          return redirectTo(`${origin}/dashboard?gh_error=token_exchange_failed`);
        }
        const tokenJson = (await tokenRes.json()) as {
          access_token?: string;
          scope?: string;
          error?: string;
        };
        if (!tokenJson.access_token) {
          return redirectTo(`${origin}/dashboard?gh_error=${tokenJson.error ?? "no_token"}`);
        }

        // Fetch GitHub user
        const userRes = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${tokenJson.access_token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "repo-finisher",
          },
        });
        const userJson = (await userRes.json()) as { login?: string };
        const login = userJson.login ?? "unknown";

        // Persist using admin client
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("github_connections").upsert(
          {
            user_id: userId,
            github_login: login,
            access_token: tokenJson.access_token,
            scope: tokenJson.scope ?? null,
            connected_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        if (error) {
          return redirectTo(`${origin}/dashboard?gh_error=db_${encodeURIComponent(error.message)}`);
        }

        return redirectTo(`${origin}/dashboard?gh=connected`);
      },
    },
  },
});

function redirectTo(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}
