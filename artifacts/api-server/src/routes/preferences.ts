import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { encryptSecret, secretsConfigured } from "../lib/secrets";

const router: IRouter = Router();

/**
 * Columns that may be read back by a client.
 *
 * `custom_ai_key` is deliberately absent: the previous handler selected `*`,
 * so a user's provider key was returned to the browser on every settings load.
 * The key is write-only now — clients learn only whether one is set.
 */
const READABLE_COLUMNS = [
  "user_id",
  "email_notifications",
  "schedule_enabled",
  "schedule_frequency",
  "custom_ai_provider",
  "filter_languages",
  "filter_exclude_archived",
  "filter_min_stars",
  "filter_max_repos",
  "analysis_tier",
  "created_at",
  "updated_at",
].join(", ");

const updateSchema = z.object({
  email_notifications: z.boolean().optional(),
  schedule_enabled: z.boolean().optional(),
  schedule_frequency: z.enum(["weekly", "monthly"]).optional(),
  custom_ai_provider: z.string().max(60).optional(),
  /** Write-only. `null` clears the stored key. */
  custom_ai_key: z.string().max(500).nullable().optional(),
  filter_languages: z.array(z.string().max(60)).max(50).optional(),
  filter_exclude_archived: z.boolean().optional(),
  filter_min_stars: z.number().int().min(0).optional(),
  filter_max_repos: z.number().int().min(2).max(500).optional(),
  analysis_tier: z.enum(["fast", "balanced", "deep"]).optional(),
});

type PreferenceRow = Record<string, unknown>;

async function readPreferences(req: Parameters<typeof requireAuth>[0]): Promise<PreferenceRow | null> {
  const { data, error } = await req.supabase!
    .from("user_preferences")
    .select(`${READABLE_COLUMNS}, custom_ai_key`)
    .eq("user_id", req.userId!)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as PreferenceRow | null;
}

/** Strip the secret and replace it with the only fact a client needs. */
function toClientShape(row: PreferenceRow | null): PreferenceRow {
  if (!row) return { custom_ai_key_set: false };
  const { custom_ai_key, ...rest } = row;
  return { ...rest, custom_ai_key_set: Boolean(custom_ai_key) };
}

router.get(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(toClientShape(await readPreferences(req)));
  }),
);

router.patch(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const userId = req.userId!;

    const update: Record<string, unknown> = { ...input };
    if ("custom_ai_key" in input) {
      const key = input.custom_ai_key;
      if (key === null || key === "") {
        update["custom_ai_key"] = null;
      } else if (key !== undefined) {
        if (!secretsConfigured()) {
          throw Object.assign(
            new Error("Cannot store an AI provider key: SECRET_ENCRYPTION_KEY is not configured on the server."),
            { status: 503 },
          );
        }
        update["custom_ai_key"] = encryptSecret(key);
      }
    }

    const { data: existing } = await req.supabase!
      .from("user_preferences")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      const { error } = await req.supabase!.from("user_preferences").update(update).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await req.supabase!.from("user_preferences").insert({ user_id: userId, ...update });
      if (error) throw new Error(error.message);
    }

    res.json(toClientShape(await readPreferences(req)));
  }),
);

export default router;
