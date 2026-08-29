import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { GitBranch, Zap, Target, Sparkles } from 'lucide-react';

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-white dark">
      {/* Navigation */}
      <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
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

      {/* Hero */}
      <section className="relative py-24 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 leading-tight text-white">
            Stop collecting.
            <br />
            <span className="text-gradient-cyan">Start shipping.</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
            AI-powered portfolio analysis that finds the products hiding in your GitHub repos.
            Finish, combine, or repurpose — get specific, actionable opportunities.
          </p>
          <Link href="/auth">
            <Button size="lg" className="text-lg px-8 h-14" data-testid="button-cta-hero">
              Connect GitHub & Analyze
            </Button>
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-card/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-16">Four-stage analysis</h2>
          <div className="grid md:grid-cols-4 gap-8">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <GitBranch className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-white">Profile</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                AI reads your entire portfolio to understand your technical identity and domain expertise.
              </p>
            </div>

            <div className="space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Target className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-white">Analyze</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Clusters repos by domain, identifies synergies, and builds a custom analysis strategy.
              </p>
            </div>

            <div className="space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-white">Critique</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Self-critiques the analysis to remove generic advice and sharpen recommendations.
              </p>
            </div>

            <div className="space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-white">Synthesize</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Generates ranked opportunities with effort scores, tech stacks, and marketing copy.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-16">What you get</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="border border-border rounded-lg p-6 bg-card">
              <div className="font-mono text-sm text-primary mb-3">FINISH</div>
              <h3 className="text-xl font-semibold text-white mb-3">Polish & Ship</h3>
              <p className="text-muted-foreground mb-4">
                Repos that are 80% done. AI tells you exactly what's missing, estimates effort, and writes launch copy.
              </p>
              <div className="text-sm font-mono text-muted-foreground">
                Next steps · Tech stack · Marketing
              </div>
            </div>

            <div className="border border-border rounded-lg p-6 bg-card">
              <div className="font-mono text-sm text-chart-2 mb-3">COMBINE</div>
              <h3 className="text-xl font-semibold text-white mb-3">Merge Into One</h3>
              <p className="text-muted-foreground mb-4">
                Related repos that solve the same problem differently. Get merge instructions and a new repo name.
              </p>
              <div className="text-sm font-mono text-muted-foreground">
                Merge plan · New name · Positioning
              </div>
            </div>

            <div className="border border-border rounded-lg p-6 bg-card">
              <div className="font-mono text-sm text-chart-3 mb-3">REPURPOSE</div>
              <h3 className="text-xl font-semibold text-white mb-3">Turn Into SaaS</h3>
              <p className="text-muted-foreground mb-4">
                Internal tools or libraries that could be products. AI pitches the market opportunity.
              </p>
              <div className="text-sm font-mono text-muted-foreground">
                Market fit · Pricing ideas · Roadmap
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent to-primary/5">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Your repos are waiting
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Takes 2 minutes to connect. First analysis runs immediately.
          </p>
          <Link href="/auth">
            <Button size="lg" className="text-lg px-8 h-14" data-testid="button-cta-footer">
              Get Started Free
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center text-sm text-muted-foreground">
          RepoFinisher · Built for indie hackers who ship
        </div>
      </footer>
    </div>
  );
}
