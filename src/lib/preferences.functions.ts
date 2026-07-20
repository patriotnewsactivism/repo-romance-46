import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// âââ Star / Unstar a recommendation âââââââââââââââââââââââââââ

export const toggleStar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { itemId: string; starred: boolean }) =>
    z.object({ itemId: z.string().uuid(), starred: z.boolean() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("analysis_items")
      .update({
        is_starred: data.starred,
        starred_at: data.starred ? new Date().toISOString() : null,
      })
      .eq("id", data.itemId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { isStarred: data.starred };
  });

// âââ Get user preferences âââââââââââââââââââââââââââââââââââââ

export interface UserPreferences {
  email_notifications: boolean;
  schedule_enabled: boolean;
  schedule_frequency: "weekly" | "monthly";
  last_scheduled_run: string | null;
  custom_ai_provider: string;
  custom_ai_key: string | null;
  filter_languages: string[];
  filter_exclude_archived: boolean;
  filter_min_stars: number;
  filter_max_repos: number;
}

export const getPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (!data) {
      // Create default preferences if none exist
      const { data: created, error: cErr } = await context.supabase
        .from("user_preferences")
        .insert({ user_id: context.userId })
        .select("*")
        .single();
      if (cErr) throw new Error(cErr.message);
      return created as unknown as UserPreferences;
    }

    return data as unknown as UserPreferences;
  });

// âââ Update user preferences ââââââââââââââââââââââââââââââââââ

export const updatePreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: Partial<UserPreferences>) =>
    z
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
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    // Use update() not upsert() â upsert replaces the whole row and would
    // null out any column not explicitly in the payload (e.g. custom_ai_key
    // when the user leaves the field blank to keep their saved key).
    const { error } = await context.supabase
      .from("user_preferences")
      .update({
        ...data,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// âââ Get starred recommendations across all analyses ââââââââââ

export const getStarredItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("analysis_items")
      .select(
        `
        *,
        analyses!inner(id, created_at, repo_count)
      `,
      )
      .eq("user_id", context.userId)
      .eq("is_starred", true)
      .order("starred_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });
