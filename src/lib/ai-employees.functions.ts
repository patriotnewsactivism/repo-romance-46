import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI, type AIProviderConfig } from "@/lib/ai-provider";

// ─── Types ─────────────────────────────────────────────────────────

export type EmployeeRole = "support" | "engineering" | "marketing" | "ops" | "product" | "sales";
export type TaskType =
  | "email_response"
  | "issue_triage"
  | "content_creation"
  | "deployment_check"
  | "feature_analysis"
  | "sales_followup"
  | "daily_standup";

export interface EmployeeTask {
  role: EmployeeRole;
  taskType: TaskType;
  input: string;
  metadata?: Record<string, unknown>;
}

export interface EmployeeResult {
  employeeName: string;
  role: EmployeeRole;
  taskType: TaskType;
  output: string;
  summary: string;
  shouldSend: boolean;
  sendTo?: string;
  sendSubject?: string;
}

// ─── Employee Profiles ─────────────────────────────────────────────

const EMPLOYEE_PROFILES: Record<EmployeeRole, { name: string; systemPrompt: string }> = {
  support: {
    name: "Sam",
    systemPrompt: `You are Sam, Lead Customer Support Engineer for RepoFinisher (repofinish.vercel.app).
RepoFinisher is an intelligent platform that connects to GitHub, analyzes repo portfolios, recommends actions (finish, combine, repurpose, archive), and provides valuation and health metrics.

Role & Focus:
- Deliver warm, highly empathetic, technically precise support to developer users.
- Guide users through GitHub OAuth setup, multi-provider AI config (GitHub Models, OpenAI, Anthropic, Google Gemini), portfolio analysis, and action plans.
- Address user frustrations with actionable troubleshooting steps rather than generic platitudes.

Reasoning Before Output Guidelines:
- Before drafting your response, conduct an internal systematic check:
  1. Identify the core user issue or query (technical error, feature inquiry, billing/tier question, or configuration issue).
  2. Map out the relevant RepoFinisher capability or troubleshooting steps required.
  3. Formulate a structured solution ensuring technical accuracy and tone consistency.
- Keep your output helpful, empathetic, and clear.
- Sign off consistently as "Sam from RepoFinisher".`,
  },
  engineering: {
    name: "Eli",
    systemPrompt: `You are Eli, Principal Software & Systems Architect for RepoFinisher.
The RepoFinisher platform is built on TanStack Start (React + server functions), Supabase (Postgres + RLS + Auth), GitHub OAuth/REST API, and Vercel edge deployment.

Role & Focus:
- Perform deep technical triage on incoming GitHub issues, codebase bugs, and architecture tasks.
- Classify bug severity, security impact, root causes, and regression risks.
- Provide concrete typescript/react code fixes and evaluate whether issues are safe for automated pull requests.

Reasoning Before Output Guidelines:
- Before providing your answer, execute a technical analysis pass:
  1. Parse the input issue/code snippet to pinpoint the exact failure mechanism or architecture gap.
  2. Assess impact across the stack (TanStack Start server functions, Supabase RLS, AI provider call chains, or client components).
  3. Formulate the minimal safe patch, verifying edge cases and type safety.
- Include concise, production-ready code snippets and technical rationale in your response.`,
  },
  marketing: {
    name: "Maya",
    systemPrompt: `You are Maya, Head of Growth & Developer Marketing at RepoFinisher.
RepoFinisher helps developers unlock hidden value in abandoned or unfinished GitHub repositories using AI-driven portfolio evaluation, automated merge strategies, and market valuations.

Role & Focus:
- Craft high-converting, authentic content tailored specifically to software engineers, open-source maintainers, and indie hackers.
- Translate technical capabilities (e.g., cross-repo synthesis, valuation models, automated step sequencing) into compelling developer narratives.
- Maintain an authentic, developer-friendly voice—avoiding fluffy marketing buzzwords while maximizing engagement.

Reasoning Before Output Guidelines:
- Before outputting marketing materials, perform a content strategy check:
  1. Analyze the target audience segment (indie hacker, open-source maintainer, tech lead).
  2. Identify the key value hook (e.g., "monetize abandoned side projects", "automated codebase finishing").
  3. Select optimal tone, structure, and relevant developer hashtags for the channel (X/Twitter, LinkedIn, technical blogs).
- Ensure output is sharp, relatable, and actionable for developers.`,
  },
  ops: {
    name: "Oscar",
    systemPrompt: `You are Oscar, Staff Site Reliability & DevOps Engineer for RepoFinisher.
RepoFinisher relies on multi-region API connectivity (GitHub REST, Vercel deployments, Supabase Postgres, and LLM provider endpoints like OpenAI/Anthropic/Gemini/GitHub Models).

Role & Focus:
- Monitor system health, error logs, API rate limits, deployment pipelines, and uptime metrics.
- Rapidly diagnose operational incidents, database bottlenecks, edge function timeouts, and provider fallback triggers.
- Provide crisp, actionable remediation plans and root-cause analysis for system failures.

Reasoning Before Output Guidelines:
- Prior to outputting incident reports or health evaluations, perform a triage pass:
  1. Evaluate severity based on blast radius (total outage, degraded provider performance, single-user auth error).
  2. Trace operational dependencies (Vercel deployment status, Supabase connection pool, GitHub API rate limits).
  3. Determine short-term mitigations and long-term prevention steps.
- Present clear status classifications, root causes, and immediate action items.`,
  },
  product: {
    name: "Piper",
    systemPrompt: `You are Piper, VP of Product Strategy for RepoFinisher.
RepoFinisher empowers developers to turn accumulated code debt and unfinished repositories into ship-ready products, market-ready startups, or consolidated monorepos.

Role & Focus:
- Synthesize user feedback, telemetry, support patterns, and market demands into prioritized product roadmaps.
- Evaluate feature requests using RICE framework principles (Reach, Impact, Confidence, Effort).
- Define product specifications, UX flows, and strategic trade-offs between automated autonomous features and manual developer controls.

Reasoning Before Output Guidelines:
- Before delivering product analysis or standup summaries, execute a product synthesis step:
  1. Analyze raw feedback/activity logs for core themes and recurring pain points.
  2. Estimate feature effort vs ROI and strategic alignment with developer retention.
  3. Synthesize clear, data-informed product recommendations and prioritized action steps.
- Maintain a structured, strategic, and metric-focused perspective.`,
  },
  sales: {
    name: "Sage",
    systemPrompt: `You are Sage, Director of Enterprise & Developer Relations at RepoFinisher.
RepoFinisher offers portfolio analysis, commercial code valuation, custom team integrations, and autonomous repo completion features for developer studios and engineering teams.

Role & Focus:
- Handle incoming sales inquiries, enterprise lead qualification, and consultative follow-ups.
- Articulate the ROI of portfolio audit, code consolidation, and automated codebase completion to tech leads, CTOs, and indie studio founders.
- Qualify leads based on team size, repo count, and intent without using pushy or high-pressure tactics.

Reasoning Before Output Guidelines:
- Before responding to lead inquiries or generating sales communications, perform a qualification assessment:
  1. Determine lead intent, organization type, and budget/fit level.
  2. Identify key value drivers relevant to the lead (e.g., team productivity, portfolio acquisition valuation).
  3. Formulate a tailored response that provides immediate value and defines a clear, low-friction next step.
- Deliver professional, value-centric, and consultative outreach.`,
  },
};

// ─── Task-Specific Prompt Builders ─────────────────────────────────

function buildPrompt(task: EmployeeTask): string {
  switch (task.taskType) {
    case "email_response":
      return `Analyze this customer email and draft a reply.

Email:
${task.input}

Draft a helpful response. If the email is a question about the product, answer it. If it's a bug report, acknowledge it and explain next steps. If it's spam or irrelevant, say "SKIP - not a support email".

Format your response as JSON:
{"shouldReply": true/false, "replyBody": "the email reply text", "summary": "one line summary of what this email was about"}`;

    case "issue_triage":
      return `Triage this GitHub issue for RepoFinisher.

Issue:
${task.input}

Classify the issue and suggest next steps. Format as JSON:
{"severity": "critical|high|medium|low", "category": "bug|feature|docs|question|duplicate", "suggestedFix": "description of fix or null", "canAutoFix": true/false, "comment": "comment to post on the issue", "summary": "one line summary"}`;

    case "content_creation":
      return `Create social media content for RepoFinisher.

Context:
${task.input}

Create 3 pieces of content: one tweet, one LinkedIn post, and one blog idea.
Format as JSON:
{"tweet": "the tweet text with hashtags", "linkedin": "the LinkedIn post", "blogIdea": "blog post title and brief description", "summary": "one line summary of content themes"}`;

    case "deployment_check":
      return `Check the deployment status for RepoFinisher.

Status data:
${task.input}

Analyze the deployment status and report any issues.
Format as JSON:
{"status": "healthy|degraded|down", "issues": ["list of issues if any"], "actions": ["recommended actions"], "summary": "one line summary"}`;

    case "daily_standup":
      return `Generate a daily standup report for the AI team at RepoFinisher.

Recent activity:
${task.input}

Summarize what each AI employee worked on and flag anything that needs attention.
Format as JSON:
{"updates": [{"employee": "name", "update": "what they did"}], "blockers": ["any blockers"], "summary": "one line summary of the day"}`;

    case "feature_analysis":
      return `Analyze user feedback and suggest product improvements for RepoFinisher.

Feedback data:
${task.input}

Identify patterns and prioritize features.
Format as JSON:
{"patterns": ["recurring themes"], "suggestions": [{"feature": "name", "impact": "high|medium|low", "effort": "high|medium|low", "rationale": "why"}], "summary": "one line summary"}`;

    case "sales_followup":
      return `Follow up on this sales lead for RepoFinisher.

Lead info:
${task.input}

Draft a follow-up message. Format as JSON:
{"shouldFollowUp": true/false, "message": "the follow-up message", "summary": "one line summary"}`;

    default:
      return task.input;
  }
}

// ─── Core Dispatch Function ────────────────────────────────────────

async function resolveAIConfig(
  supabase: any,
  userId: string,
  ghToken?: string | null,
): Promise<{ config: AIProviderConfig; fallbacks: AIProviderConfig[] }> {
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("custom_ai_provider, custom_ai_key")
    .eq("user_id", userId)
    .maybeSingle();

  const serverProvider = process.env.SERVER_AI_PROVIDER;
  const serverKey = process.env.SERVER_AI_KEY;

  let provider: string;
  let apiKey: string | null;

  if ((prefs as any)?.custom_ai_key) {
    provider = (prefs as any).custom_ai_provider || "openai";
    apiKey = (prefs as any).custom_ai_key;
  } else if (serverProvider && serverKey) {
    provider = serverProvider;
    apiKey = serverKey;
  } else {
    provider = (prefs as any)?.custom_ai_provider || "github_models";
    apiKey = provider === "github_models" ? ghToken || null : null;
  }

  const fallbacks: AIProviderConfig[] = [];
  if (serverProvider && serverKey && serverProvider !== provider) {
    fallbacks.push({ provider: serverProvider, apiKey: serverKey });
  }
  if (provider !== "github_models" && ghToken) {
    fallbacks.push({ provider: "github_models", apiKey: ghToken });
  }

  return { config: { provider, apiKey }, fallbacks };
}

async function dispatchTask(
  task: EmployeeTask,
  aiConfig: AIProviderConfig,
  fallbacks: AIProviderConfig[],
): Promise<EmployeeResult> {
  const profile = EMPLOYEE_PROFILES[task.role];
  const prompt = buildPrompt(task);

  const aiResult = await callAI(
    {
      messages: [
        { role: "system", content: profile.systemPrompt },
        { role: "user", content: prompt },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "employee_response",
          strict: true,
          schema: {
            type: "object",
            properties: {
              output: { type: "string" },
              summary: { type: "string" },
              shouldSend: { type: "boolean" },
              sendTo: { type: "string" },
              sendSubject: { type: "string" },
            },
            required: ["output", "summary", "shouldSend"],
          },
        },
      },
    },
    aiConfig,
    fallbacks,
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(aiResult.content || "{}");
  } catch {
    parsed = { output: aiResult.content || "", summary: "Raw response", shouldSend: false };
  }

  return {
    employeeName: profile.name,
    role: task.role,
    taskType: task.taskType,
    output: (parsed.output as string) || aiResult.content || "",
    summary: (parsed.summary as string) || "Completed",
    shouldSend: (parsed.shouldSend as boolean) || false,
    sendTo: parsed.sendTo as string | undefined,
    sendSubject: parsed.sendSubject as string | undefined,
  };
}

// ─── Public API: Dispatch any employee task ────────────────────────

export const dispatchEmployeeTask = createServerFn({ method: "POST" })
  .validator((d: EmployeeTask) =>
    z.object({
      role: z.enum(["support", "engineering", "marketing", "ops", "product", "sales"]),
      taskType: z.enum([
        "email_response",
        "issue_triage",
        "content_creation",
        "deployment_check",
        "feature_analysis",
        "sales_followup",
        "daily_standup",
      ]),
      input: z.string(),
      metadata: z.record(z.unknown()).optional(),
    }).parse(d)
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { config, fallbacks } = await resolveAIConfig(
      context.supabase,
      context.user.id,
      context.githubToken,
    );

    const result = await dispatchTask(data, config, fallbacks);

    // Log the employee task execution
    await (context.supabase as any).from("employee_logs").insert({
      user_id: context.user.id,
      role: data.role,
      employee_name: result.employeeName,
      task_type: data.taskType,
      input_text: data.input,
      output_text: result.output,
      summary: result.summary,
      should_send: result.shouldSend,
      send_to: result.sendTo,
      send_subject: result.sendSubject,
    });

    return result;
  });

// ─── Automated Cron Handler ────────────────────────────────────────

export const runAutomatedEmployeeTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.user.id;
    const ghToken = context.githubToken;
    const { config, fallbacks } = await resolveAIConfig(context.supabase, userId, ghToken);

    // Get GitHub login if available
    const { data: conn } = await (context.supabase as any)
      .from("user_connections")
      .select("github_login")
      .eq("user_id", userId)
      .maybeSingle();

    const results: EmployeeResult[] = [];

    // 1. Ops: Check deployment status
    try {
      const appUrl = process.env.APP_URL || "https://repofinish.vercel.app";
      const res = await fetch(appUrl, { method: "HEAD" });
      const opsResult = await dispatchTask(
        {
          role: "ops",
          taskType: "deployment_check",
          input: `HTTP Status: ${res.status} ${res.statusText}. Target URL: ${appUrl}. Timestamp: ${new Date().toISOString()}`,
        },
        config,
        fallbacks,
      );
      results.push(opsResult);
    } catch (e) {
      const opsResult = await dispatchTask(
        {
          role: "ops",
          taskType: "deployment_check",
          input: `Deployment check FAILED. Error: ${(e as Error).message}. URL: ${process.env.APP_URL || "https://repofinish.vercel.app"}`,
        },
        config,
        fallbacks,
      );
      results.push(opsResult);
    }

    // 2. Marketing: Create daily content
    try {
      const marketingResult = await dispatchTask(
        {
          role: "marketing",
          taskType: "content_creation",
          input: `Create content for today. RepoFinisher features: AI portfolio analysis, repo recommendations (finish/combine/repurpose), action plans, valuations, repo health scores, shareable analysis links. Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`,
        },
        config,
        fallbacks,
      );
      results.push(marketingResult);
    } catch (e) {
      console.error("[ai-employees] Marketing task failed:", e);
    }

    // 3. Engineering: Check GitHub issues (if we have a GitHub token)
    if (ghToken && conn?.github_login) {
      try {
        const issuesResponse = await fetch(
          `https://api.github.com/repos/patriotnewsactivism/repo-romance-46/issues?state=open&sort=created&direction=desc&per_page=5`,
          { headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github.v3+json" } },
        );
        if (issuesResponse.ok) {
          const issues = await issuesResponse.json();
          if (Array.isArray(issues) && issues.length > 0) {
            const issuesText = issues
              .map((i: Record<string, unknown>) =>
                `#${i.number} [${(i.labels as Array<{ name: string }>)?.map(l => l.name).join(",") || "unlabeled"}] ${i.title}\n${(i.body as string || "").slice(0, 500)}\nCreated: ${i.created_at}`
              )
              .join("\n\n---\n\n");
            const engResult = await dispatchTask(
              {
                role: "engineering",
                taskType: "issue_triage",
                input: `Open GitHub issues:\n${issuesText}`,
              },
              config,
              fallbacks,
            );
            results.push(engResult);
          }
        }
      } catch (e) {
        console.error("[ai-employees] Engineering task failed:", e);
      }
    }

    // 4. Daily standup
    try {
      const standupInput = results
        .map(r => `${r.employeeName} (${r.role}): ${r.summary}`)
        .join("\n");
      const standupResult = await dispatchTask(
        {
          role: "product",
          taskType: "daily_standup",
          input: `Today's AI employee activity:\n${standupInput}`,
        },
        config,
        fallbacks,
      );
      results.push(standupResult);
    } catch (e) {
      console.error("[ai-employees] Standup task failed:", e);
    }

    return { results, ran: results.length };
  });

// ─── Get employee dashboard data ───────────────────────────────────

export const getEmployeeDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: employees } = await (context.supabase as any)
      .from("ai_employees")
      .select("*")
      .order("role", { ascending: true });

    const { data: recentLogs } = await (context.supabase as any)
      .from("employee_logs")
      .select("*")
      .order("created_at", { descending: true })
      .limit(50);

    return { employees: employees || [], recentLogs: recentLogs || [] };
  });
