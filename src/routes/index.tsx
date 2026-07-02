import { createFileRoute, Link } from "@tanstack/react-router";
import { Github, GitMerge, Rocket, Sparkles } from "lucide-react";

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
        <Link
          to="/auth"
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Sign in
        </Link>
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

        <div id="how" className="mt-24 grid gap-6 text-left md:grid-cols-3">
          {[
            {
              icon: Rocket,
              title: "Finish",
              desc: "The repos that are 80% done. We list exactly what's missing to ship.",
              color: "text-ship",
            },
            {
              icon: GitMerge,
              title: "Combine",
              desc: "Repos that individually go nowhere — but together become a product.",
              color: "text-combine",
            },
            {
              icon: Sparkles,
              title: "Repurpose",
              desc: "Repositioning old code as a marketable tool, library, or SaaS.",
              color: "text-repurpose",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-card p-6">
              <f.icon className={`h-6 w-6 ${f.color}`} />
              <h3 className="mt-4 font-mono font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
