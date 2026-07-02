import { createAPIFileRoute } from "@tanstack/react-start/api";
import { runScheduledAnalyses } from "@/lib/scheduled-runner.functions";

// GET /api/cron/scheduled-analysis
// Called by a cron scheduler (Vercel Cron, Cloudflare Cron, or external)
// Auth: Bearer token matching CRON_SECRET env var
export const GET = createAPIFileRoute("/api/cron/scheduled-analysis")({
  handler: async ({ request }) => {
    const fn = runScheduledAnalyses;
    // Call the server function with the request (it checks auth internally)
    const result = await fn({ request });
    return Response.json(result);
  },
});
