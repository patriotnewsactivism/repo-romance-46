import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, FileDown, FileText, Repeat2, Search, ShieldCheck, Sparkles } from "lucide-react";

const tools = [
  {
    icon: BarChart3,
    title: "Analyze & value",
    badge: "Read-only",
    detail: "Scores completion, production readiness, evidence confidence, replacement cost, commercialization, IP overlap, and finish-first value unlock. Estimates stay labeled as estimates.",
  },
  {
    icon: Repeat2,
    title: "Finish until target",
    badge: "Writes draft PR",
    detail: "Runs repeated evidence -> plan -> implementation -> verification -> re-score cycles until completion/readiness targets are met or a safety/no-progress stop condition is reached. Automatic merge is off.",
  },
  {
    icon: Search,
    title: "Research market & competitors",
    badge: "Source-backed",
    detail: "Uses live external research when configured. Competitor names, customer pricing, features, and URLs are only shown when source evidence supports them; otherwise RepoFinisher says the evidence is unavailable.",
  },
  {
    icon: Sparkles,
    title: "Find valuable features",
    badge: "Plan first",
    detail: "Suggests coherent improvements, estimates incremental IP/value impact and scenario revenue, explains assumptions/risks, then generates an exact implementation plan for review before any repository write.",
  },
  {
    icon: FileText,
    title: "Reconcile documentation",
    badge: "Docs-only guard",
    detail: "Updates README, AGENTS.md, plans/roadmaps, and docs from verified implementation evidence. A server-side guard rejects plans that attempt to modify non-documentation files.",
  },
  {
    icon: FileDown,
    title: "Export investor PDF",
    badge: "Evidence-aware",
    detail: "Creates an investor-facing PDF from the current portfolio intelligence, adjusted valuation, finish-first ranking, roadmap, diligence priorities, and explicit valuation disclaimers.",
  },
  {
    icon: ShieldCheck,
    title: "Safe implementation contract",
    badge: "Always enforced",
    detail: "Pins the base SHA, uses isolated branches and draft PRs, blocks stale plans, verifies CI/runtime evidence where available, forbids weakening tests/security, and never auto-merges by default.",
  },
];

export function CapabilityGuide() {
  return (
    <details className="rounded-lg border border-border bg-card p-4">
      <summary className="cursor-pointer list-none flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <div className="font-semibold">What RepoFinisher can do - and what each action changes</div>
          <div className="text-xs text-muted-foreground">Open this before running a tool if you want the plain-language difference between analysis, planning, repository writes, and evidence requirements.</div>
        </div>
      </summary>
      <div className="grid gap-3 mt-4 md:grid-cols-2 xl:grid-cols-3">
        {tools.map(({ icon: Icon, title, badge, detail }) => (
          <Card key={title} className="p-3 space-y-2 bg-muted/10">
            <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-primary" /><span className="font-semibold text-sm">{title}</span><Badge variant="outline" className="ml-auto text-[10px]">{badge}</Badge></div>
            <p className="text-xs text-muted-foreground leading-relaxed">{detail}</p>
          </Card>
        ))}
      </div>
    </details>
  );
}
