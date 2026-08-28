import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import {
  buildExternalCompletionPrompt,
  type ExternalPromptProvider,
} from "../lib/external-completion-prompt";

const router: IRouter = Router();
const providerSchema = z.enum(["provider-neutral", "codex", "claude-code", "gemini-cli"]);

router.post(
  "/repo-finisher/external-prompt",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z.object({
      repo: z.string().regex(/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/),
      analysisId: z.string().uuid().optional(),
      itemRank: z.number().int().nonnegative().optional(),
      provider: providerSchema.default("provider-neutral"),
    }).parse(req.body);

    const generated = await buildExternalCompletionPrompt(req.supabase!, req.userId!, {
      repo: input.repo,
      analysisId: input.analysisId,
      itemRank: input.itemRank,
      provider: input.provider as ExternalPromptProvider,
    });
    const { data, error } = await req.supabase!
      .from("external_completion_prompts")
      .insert({
        user_id: req.userId!,
        repo: input.repo,
        analysis_id: input.analysisId ?? null,
        reasoning_trace_id: generated.assessment.reasoningTraceId,
        head_sha: generated.assessment.headSha,
        default_branch: generated.assessment.defaultBranch,
        provider_hint: generated.provider,
        prompt_version: generated.promptVersion,
        prompt_md: generated.prompt,
        assessment: generated.assessment,
      })
      .select("id, created_at")
      .single();
    if (error || !data) throw new Error(`Failed to persist external completion prompt: ${error?.message ?? "unknown database error"}`);

    res.status(201).json({
      id: (data as Record<string, unknown>).id,
      createdAt: (data as Record<string, unknown>).created_at,
      ...generated,
      note: "This prompt is a portable engineering handoff. It does not approve repository writes inside RepoFinisher and does not replace RepoFinisher's own completion workflow.",
    });
  }),
);

router.get(
  "/repo-finisher/external-prompts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = z.object({
      analysisId: z.string().uuid().optional(),
      repo: z.string().regex(/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).parse(req.query);
    let request = req.supabase!
      .from("external_completion_prompts")
      .select("id, repo, analysis_id, reasoning_trace_id, head_sha, default_branch, provider_hint, prompt_version, assessment, created_at")
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: false })
      .limit(query.limit);
    if (query.analysisId) request = request.eq("analysis_id", query.analysisId);
    if (query.repo) request = request.eq("repo", query.repo);
    const { data, error } = await request;
    if (error) throw new Error(`Failed to list external completion prompts: ${error.message}`);
    res.json(data ?? []);
  }),
);

router.get(
  "/repo-finisher/external-prompts/:promptId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { promptId } = z.object({ promptId: z.string().uuid() }).parse(req.params);
    const { data, error } = await req.supabase!
      .from("external_completion_prompts")
      .select("*")
      .eq("id", promptId)
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (error) throw new Error(`Failed to load external completion prompt: ${error.message}`);
    if (!data) throw Object.assign(new Error("External completion prompt not found."), { status: 404 });
    res.json(data);
  }),
);

export default router;
