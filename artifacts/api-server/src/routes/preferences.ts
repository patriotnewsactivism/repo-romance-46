import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";

const router: IRouter = Router();

router.post(
  "/preferences/star",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = z.object({ itemId: z.string().uuid(), starred: z.boolean() }).parse(req.body);
    const { error } = await req.supabase!
      .from("analysis_items")
      .update({
        is_starred: data.starred,
        starred_at: data.starred ? new Date().toISOString() : null,
      })
      .eq("id", data.itemId)
      .eq("user_id", req.userId!);
    if (error) throw new Error(error.message);
    res.json({ isStarred: data.starred });
  }),
);

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

    if (!data) {
      const { data: created, error: cErr } = await req.supabase!
        .from("user_preferences")
        .insert({ user_id: req.userId! })
        .select("*")
        .single();
      if (cErr) throw new Error(cErr.message);
      return void res.json(created);
    }

    res.json(data);
  }),
);

router.post(
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
      })
      .parse(req.body);

    const { error } = await req.supabase!
      .from("user_preferences")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("user_id", req.userId!);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  }),
);

router.get(
  "/preferences/starred",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.supabase!
      .from("analysis_items")
      .select(`*, analyses!inner(id, created_at, repo_count)`)
      .eq("user_id", req.userId!)
      .eq("is_starred", true)
      .order("starred_at", { ascending: false });
    if (error) throw new Error(error.message);
    res.json(data);
  }),
);

export default router;
