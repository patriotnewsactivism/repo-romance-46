import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";

const router: IRouter = Router();

// Public shared analysis view — no auth required, uses anon key over REST.
router.get(
  "/public/analysis/:slug",
  asyncHandler(async (req, res) => {
    const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
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
