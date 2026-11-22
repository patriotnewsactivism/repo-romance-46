import { Router, type IRouter } from "express";
import { z } from "zod";
import { createServiceClient } from "@workspace/db";
import { asyncHandler } from "../lib/async-handler";

const router: IRouter = Router();

// Public shared analysis view — no auth required. Uses the unrestricted client
// because the share slug itself is the capability, and the rows are filtered by
// `is_public` exactly as the old anon REST query did.
router.get(
  "/public/analysis/:slug",
  asyncHandler(async (req, res) => {
    const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);
    const db = createServiceClient();

    const { data: analysis, error } = await db
      .from<Record<string, unknown>>("analyses")
      .select("*")
      .eq("share_slug", slug)
      .eq("is_public", true)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch analysis: ${error.message}`);
    if (!analysis) {
      throw Object.assign(new Error("Analysis not found or no longer shared."), { status: 404 });
    }

    const expiresAt = analysis["share_expires_at"];
    if (expiresAt && Date.now() > new Date(String(expiresAt)).getTime()) {
      throw Object.assign(new Error("This shared analysis has expired."), { status: 410 });
    }

    const { data: items, error: itemsError } = await db
      .from<Record<string, unknown>>("analysis_items")
      .select("*")
      .eq("analysis_id", analysis["id"])
      .order("rank", { ascending: true });

    if (itemsError) throw new Error(`Failed to fetch analysis items: ${itemsError.message}`);

    res.json({ analysis, items: items ?? [] });
  }),
);

export default router;
