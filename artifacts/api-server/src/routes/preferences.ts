import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";

const router: IRouter = Router();

router.get(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.supabase!
      .from("user_preferences")
      .select("*")
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (error) throw new Error(error.message);
    res.json(data ?? {});
  }),
);

router.patch(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        email_notifications: z.boolean().optional(),
        schedule_enabled: z.boolean().optional(),
        schedule_frequency: z.enum(["weekly", "monthly"]).optional(),
        custom_ai_provider: z.string().optional(),
        custom_ai_key: z.string().nullable().optional(),
        filter_languages: z.array(z.string()).optional(),
        filter_exclude_archived: z.boolean().optional(),
        filter_min_stars: z.number().int().min(0).optional(),
        filter_max_repos: z.number().int().min(2).max(500).optional(),
        analysis_tier: z.enum(["fast", "balanced", "deep"]).optional(),
      })
      .parse(req.body);

    const userId = req.userId!;

    // Upsert preferences (create if not exists)
    const { data: existing } = await req.supabase!
      .from("user_preferences")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      const { data: updated, error } = await req.supabase!
        .from("user_preferences")
        .update(data)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      res.json(updated);
    } else {
      const { data: inserted, error } = await req.supabase!
        .from("user_preferences")
        .insert({ user_id: userId, ...data })
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      res.json(inserted);
    }
  }),
);

export default router;
