import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Github,
  GitMerge,
  Rocket,
  Sparkles,
  Target,
  Share2,
  Download,
  Activity,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen grid-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 font-mono text-sm">
          <span className="inline-block h-2 w-2 rounded-full bg-primary glow-primary" />
          <span className="font-bold tracking-tight">repo_finisher</span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/patriotnewsactivism/repo-romance-46"
            target="_blank"
            rel="noopener"
            className="text-sm text-muted-foreground hover:text-foreground font-mono"
          >
            source
          </a>
          <Link
            to="/auth"
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pt-16 pb-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-mono text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          AI audit of your GitHub graveyard
        </div>
        <h1 className="mt-6 text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl">
          Ship the repos <br />
          <span className="font-mono text-primary">you already started.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Connect your GitHub. We deep-sample every repo, then tell you exactly which ones to{" "}
          <span className="text-foreground">finish</span>, which to{" "}
          <span className="text-foreground">combine</span>, and how to{" "}
          <span className="text-foreground">market</span> what you already built.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 glow-primary"
          >
            <Github className="h-4 w-4" /> Get started
          </Link>
          <a
            href="#how"
            className="rounded-md border border-border bg-card px-6 py-3 text-sm font-medium hover:bg-accent"
          >
            How it works
          </a>
        </div>

        {/* Example output */}
        <div id="how" className="mt-24 text-left">
          <h2 className="text-center text-2xl font-bold tracking-tight mb-2">What you get</h2>
          <p className="text-center text-sm text-muted-foreground mb-8">
            Every analysis includes ranked recommendations, marketing copy, and an action plan
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Rocket,
                title: "Finish",
                desc: "The repos that are 80% done. We list exactly what's missing to ship.",
                color: "text-ship",
                example:
                  '"Add auth, deploy to Vercel, write a landing page — this is 2 weekends from launch"',
              },
              {
                icon: GitMerge,
                title: "Combine",
                desc: "Repos that individually go nowhere — but together become a product.",
                color: "text-combine",
                example:
                  '"Merge your scraper + your dashboard + your API wrapper into a SaaS analytics tool"',
              },
              {
                icon: Sparkles,
                title: "Repurpose",
                desc: "Repositioning old code as a marketable tool, library, or SaaS.",
                color: "text-repurpose",
                example:
                  '"That abandoned CLI tool? Package it as an npm library with 3 lines of docs"',
              },
            ].map((f) => (
              <div key={f.title} className="rounded-lg border border-border bg-card p-6">
                <f.icon className={`h-6 w-6 ${f.color}`} />
                <h3 className="mt-4 font-mono font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
                <p className="mt-3 text-xs font-mono text-muted-foreground/70 italic border-l-2 border-border pl-3">
                  {f.example}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Feature grid */}
        <div className="mt-20 text-left">
          <h2 className="text-center text-2xl font-bold tracking-tight mb-8">Full toolkit</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Feature
              icon={<Activity className="h-5 w-5" />}
              title="Portfolio stats"
              desc="Language breakdown, star count, dormant repos, activity timeline"
            />
            <Feature
              icon={<Target className="h-5 w-5" />}
              title="Action plan"
              desc="AI-generated phased roadmap with quick wins and dependencies"
            />
            <Feature
              icon={<Sparkles className="h-5 w-5" />}
              title="Marketing copy"
              desc="Ready-to-post tweet + LinkedIn post for each recommendation"
            />
            <Feature
              icon={<Activity className="h-5 w-5" />}
              title="Repo health"
              desc="CI status, test coverage, license detection — graded A to F"
            />
            <Feature
              icon={<Share2 className="h-5 w-5" />}
              title="Shareable links"
              desc="Generate public URLs to share your analysis with anyone"
            />
            <Feature
              icon={<Download className="h-5 w-5" />}
              title="Export"
              desc="Download as Markdown or JSON for your records"
            />
          </div>
        </div>

        {/* How it works steps */}
        <div className="mt-20 text-left">
          <h2 className="text-center text-2xl font-bold tracking-tight mb-8">How it works</h2>
          <div className="grid gap-6 md:grid-cols-4">
            {[
              { step: "01", title: "Sign in", desc: "Create an account with email/password" },
              { step: "02", title: "Connect GitHub", desc: "One-click OAuth — we read your repos" },
              {
                step: "03",
                title: "Run analysis",
                desc: "We deep-sample up to 25 repos in ~60 seconds",
              },
              { step: "04", title: "Ship it", desc: "Follow the action plan and launch" },
            ].map((s) => (
              <div key={s.step} className="space-y-2">
                <div className="font-mono text-3xl font-bold text-primary/30">{s.step}</div>
                <h3 className="font-mono font-semibold text-sm">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-24 rounded-lg border border-border bg-card p-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Stop letting good code rot</h2>
          <p className="mt-3 text-muted-foreground">
            Your next product is already 80% written. Let's find it.
          </p>
          <Link
            to="/auth"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 glow-primary"
          >
            Get your audit <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-6 flex items-center justify-between text-xs text-muted-foreground font-mono">
          <span>repo_finisher — ship what you started</span>
          <span>built with TanStack Start + Supabase</span>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-2">
      <div className="text-primary">{icon}</div>
      <h3 className="font-mono font-semibold text-sm">{title}</h3>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}
