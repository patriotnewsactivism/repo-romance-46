import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI, type AIProviderConfig } from "@/lib/ai-provider";

// ─── Types ────────────────────────────────────────────────────

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

// ─── Employee Profiles ────────────────────────────────────────

const EMPLOYEE_PROFILES: Record<EmployeeRole, { name: string; systemPrompt: string }> = {
  support: {
    name: "Sam",
    systemPrompt: `You are Sam, the customer support agent for RepoFinisher (repofinish.vercel.app).
RepoFinisher is a tool that connects to your GitHub, analyzes your repo portfolio, and recommends which repos to finish, combine, or repurpose. It also offers portfolio valuations.

Key facts:
- Free to use with GitHub Models (no API key needed)
- Supports OpenAI, Anthropic, and Google as alternative AI providers
- Users connect via GitHub OAuth
- Analysis includes: repo recommendations, action plans, merge instructions, valuations, repo health scores

Be warm, helpful, and concise. If you don't know something, say so. Always sign off as "Sam from RepoFinisher".`,
  },
  engineering: {
    name: "Eli",
    systemPrompt: `You are Eli, the engineering agent for RepoFinisher.
The codebase uses TanStack Start (React + server functions), Supabase (auth + Postgres), GitHub OAuth, and Vercel deployment.
Your job is to triage GitHub issues, classify severity, suggest fixes, and identify which issues are safe for automated PRs.
Be technical and precise. Include code snippets when suggesting fixes.`,
  },
  marketing: {
    name: "Maya",
    systemPrompt: `You are Maya, the marketing agent for RepoFinisher.
Create engaging, authentic content about RepoFinisher — tweets, LinkedIn posts, and blog ideas.
RepoFinisher helps developers figure out what to do with their unfinished GitHub repos. It's like having an AI advisor for your code portfolio.
Keep content genuine, not salesy. Use developer-friendly language. Include relevant hashtags.`,
  },
  ops: {
    name: "Oscar",
    systemPrompt: `You are Oscar, the ops agent for RepoFinisher.
You monitor deployment health, error logs, and system uptime. You alert on issues and track reliability.
Be concise and action-oriented. Flag critical issues immediately. Include relevant URLs and error details.`,
  },
  product: {
    name: "Piper",
    systemPrompt: `You are Piper, the product agent for RepoFinisher.
You analyze user feedback, support tickets, and usage patterns to suggest product improvements.
Prioritize features by impact and effort. Track trends in user requests. Be data-driven and strategic.`,
  },
  sales: {
    name: "Sage",
    systemPrompt: `You are Sage, the sales agent for RepoFinisher.
You handle inbound sales inquiries, follow up with leads, and track conversion.
Be professional but not pushy. Focus on value and fit. Qualify leads before scheduling demos.`,
  },
};

// ─── Task-Specific Prompt Builders ────────────────────────────

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

// ─── Core Dispatch Function ───────────────────────────────────

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

// ─── Public API: Dispatch any employee task ────────────────────

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
    }).parse(d),
  )
  .handler(async ({ data }) => {
    // Use service role for employee dispatch (no user context needed)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase not configured");
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get GitHub token for AI fallback
    let ghToken: string | null = null;
    const { data: conn } = await supabase
      .from("github_connections")
      .select("access_token")
      .limit(1)
      .maybeSingle();
    ghToken = conn?.access_token || null;

    // Get a user ID for preferences (use first user)
    const { data: firstUser } = await supabase
      .from("user_preferences")
      .select("user_id")
      .limit(1)
      .maybeSingle();
    const userId = firstUser?.user_id || "";

    const { config, fallbacks } = await resolveAIConfig(supabase, userId, ghToken);

    const result = await dispatchTask(data, config, fallbacks);

    return result;
  });

// ─── Cron-callable endpoint for scheduled employee work ────────

export const runEmployeeShift = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const authHeader = request?.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return { error: "Unauthorized", results: [] };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { error: "Supabase not configured", results: [] };
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get GitHub token
  let ghToken: string | null = null;
  const { data: conn } = await supabase
    .from("github_connections")
    .select("access_token, github_login")
    .limit(1)
    .maybeSingle();
  ghToken = conn?.access_token || null;

  const { data: firstUser } = await supabase
    .from("user_preferences")
    .select("user_id")
    .limit(1)
    .maybeSingle();
  const userId = firstUser?.user_id || "";

  const { config, fallbacks } = await resolveAIConfig(supabase, userId, ghToken);

  const results: EmployeeResult[] = [];

  // 1. Ops: Check deployment status
  try {
    const vercelUrl = process.env.APP_URL || "https://repofinish.vercel.app";
    const response = await fetch(vercelUrl, { method: "HEAD", signal: AbortSignal.timeout(10000) });
    const status = response.ok ? "healthy" : "degraded";
    const opsResult = await dispatchTask(
      {
        role: "ops",
        taskType: "deployment_check",
        input: `Deployment URL: ${vercelUrl}\nHTTP Status: ${response.status}\nResponse time: ${response.headers.get("x-verel-id") || "unknown"}\nStatus: ${status}`,
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

// ─── Get employee dashboard data ──────────────────────────────

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
