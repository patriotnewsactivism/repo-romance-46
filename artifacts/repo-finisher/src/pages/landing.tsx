import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { GitBranch, Gauge, GitPullRequest, Repeat2 } from 'lucide-react';

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-white dark">
      <nav className="border-b border-border bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <GitBranch className="w-6 h-6 text-primary" />
              <span className="font-bold text-xl text-white">RepoFinisher</span>
            </div>
            <Link href="/auth">
              <Button variant="default" data-testid="button-signin">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative py-24 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <img
            src="/repo-finisher-logo.png"
            alt="Repo Finisher — Close faster. Move forward."
            className="mx-auto mb-10 w-full max-w-2xl rounded-2xl shadow-2xl shadow-blue-500/10"
          />
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 leading-tight text-white">
            Inspect the graveyard.
            <br />
            <span className="text-gradient-cyan">Finish what is actually there.</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
            RepoFinisher scores completion and production readiness from repository evidence, puts an honest planning number on the portfolio, then opens draft PRs and iterates until a target — or a safe stop.
          </p>
          <Link href="/auth">
            <Button size="lg" className="text-lg px-8 h-14" data-testid="button-cta-hero">
              Connect GitHub & Analyze
            </Button>
          </Link>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-card/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-16">How a repo actually gets finished</h2>
          <div className="grid md:grid-cols-4 gap-8">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <GitBranch className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-white">Inspect</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Read the tree, tests, CI, docs, and intended product from current GitHub evidence — not from a vibe.
              </p>
            </div>
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Gauge className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-white">Score</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Completion and readiness with an evidence ceiling. Present value is replacement cost. Potential is a labeled scenario.
              </p>
            </div>
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <GitPullRequest className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-white">Draft PR</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Exact-plan writes on an isolated branch. Automatic merge stays off. Failed CI can get bounded repair.
              </p>
            </div>
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Repeat2 className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-white">Iterate</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Finish until target re-scores after each pass and stops when the target, budget, or evidence ceiling says stop.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-16">What you can do</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="border border-border rounded-lg p-6 bg-card">
              <div className="font-mono text-sm text-primary mb-3">VALUE</div>
              <h3 className="text-xl font-semibold text-white mb-3">Honest portfolio numbers</h3>
              <p className="text-muted-foreground mb-4">
                Confidence-adjusted ranges, overlap, replacement cost, and an investor PDF. No invented TAM or fake comparables.
              </p>
            </div>
            <div className="border border-border rounded-lg p-6 bg-card">
              <div className="font-mono text-sm text-chart-3 mb-3">FINISH</div>
              <h3 className="text-xl font-semibold text-white mb-3">One click, then iterate</h3>
              <p className="text-muted-foreground mb-4">
                Finish one repo or the ranked set. Each session survives a refresh and keeps working on one draft PR.
              </p>
            </div>
            <div className="border border-border rounded-lg p-6 bg-card">
              <div className="font-mono text-sm text-chart-2 mb-3">HANDOFF</div>
              <h3 className="text-xl font-semibold text-white mb-3">External coding prompts</h3>
              <p className="text-muted-foreground mb-4">
                Copy a current-state completion prompt for Codex, Claude Code, or Gemini CLI without replacing RepoFinisher.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent to-primary/5">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Your unfinished repos still count
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Connect GitHub, pick a model in Settings, run analysis, then finish until the scorecard moves.
          </p>
          <Link href="/auth">
            <Button size="lg" className="text-lg px-8 h-14" data-testid="button-cta-footer">
              Get Started Free
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center text-sm text-muted-foreground">
          RepoFinisher · Draft PRs only · Automatic merge disabled
        </div>
      </footer>
    </div>
  );
}
