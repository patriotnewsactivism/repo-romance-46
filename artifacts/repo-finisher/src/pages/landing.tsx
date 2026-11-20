import { Link } from 'wouter';
import { BRAND } from '@/lib/brand';

const MARQUEE_ITEMS = [
  'Draft PRs only ★',
  'Automatic merge disabled ★',
  'Honest portfolio numbers ★',
  'Evidence ceiling ★',
];

const REVERSE_MARQUEE_ITEMS = ['Draft PRs only ✱', 'Automatic merge disabled ✱'];

const STEPS = [
  {
    title: 'Inspect',
    body: 'Read the tree, tests, CI, docs, and intended product from current GitHub evidence — not from a vibe.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="6" cy="5" r="2.5" />
        <circle cx="6" cy="19" r="2.5" />
        <circle cx="18" cy="9" r="2.5" />
        <path d="M6 8v8M18 12c0 4-8 2-12 4" />
      </svg>
    ),
  },
  {
    title: 'Score',
    body: 'Completion and readiness with an evidence ceiling. Present value is replacement cost. Potential is a labeled scenario.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M4 18a8 8 0 1 1 16 0" />
        <path d="M12 18l4-6" />
      </svg>
    ),
  },
  {
    title: 'Draft PR',
    body: 'Exact-plan writes on an isolated branch. Automatic merge stays off. Failed CI can get bounded repair.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="6" cy="5" r="2.5" />
        <circle cx="6" cy="19" r="2.5" />
        <circle cx="18" cy="19" r="2.5" />
        <path d="M6 8v8M18 16V9a3 3 0 0 0-3-3h-3" />
      </svg>
    ),
  },
  {
    title: 'Iterate',
    body: 'Finish until target re-scores after each pass and stops when the target, budget, or evidence ceiling says stop.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M4 11V9a3 3 0 0 1 3-3h11l-3-3M20 13v2a3 3 0 0 1-3 3H6l3 3" />
      </svg>
    ),
  },
];

const CAPABILITIES = [
  {
    tag: 'VALUE',
    title: 'Honest portfolio numbers',
    body: 'Confidence-adjusted ranges, overlap, replacement cost, and an investor PDF. No invented TAM or fake comparables.',
  },
  {
    tag: 'FINISH',
    title: 'One click, then iterate',
    body: 'Finish one repo or the ranked set. Each session survives a refresh and keeps working on one draft PR.',
  },
  {
    tag: 'HANDOFF',
    title: 'External coding prompts',
    body: `Copy a current-state completion prompt for Codex, Claude Code, or Gemini CLI without replacing ${BRAND.name}.`,
  },
];

export default function Landing() {
  return (
    <div className="dark min-h-screen bg-background font-mono text-foreground">
      <nav className="sticky top-0 z-50 flex items-center justify-between border-b-[3px] border-foreground bg-background px-5 py-[22px] sm:px-12">
        <Link
          href="/"
          className="flex items-center gap-3 text-[26px] uppercase tracking-[1px] text-foreground sm:text-[30px]"
        >
          <span
            aria-hidden
            className="block h-[34px] w-[34px] rotate-[-8deg] border-[3px] border-foreground bg-primary shadow-[4px_4px_0_#9B5CFF]"
          />
          <span className="na-title">{BRAND.name}</span>
        </Link>
        <Link
          href="/auth"
          data-testid="button-signin"
          className="na-btn px-5 py-[9px] text-base shadow-[4px_4px_0_#9B5CFF]"
        >
          Sign In
        </Link>
      </nav>

      <section className="na-hero-lines relative grid items-center gap-10 border-b-[3px] border-foreground bg-background px-5 pb-16 pt-14 sm:px-12 lg:grid-cols-[1fr_440px]">
        <div className="relative">
          <div className="na-sticker">
            <i aria-hidden />
            <span className="na-title">{BRAND.name}</span>
          </div>
          <h1 className="na-slam-1 text-[56px] leading-none tracking-[-1px] sm:text-[80px] lg:text-[112px]">
            Inspect the graveyard.
            <span className="block text-primary [text-shadow:6px_6px_0_#9B5CFF]">
              Finish what is actually there.
            </span>
          </h1>
          <p className="na-slam-2 mb-8 mt-7 max-w-[620px] border-l-[6px] border-[#9B5CFF] pl-[18px] text-[17px] leading-relaxed">
            {BRAND.name} scores completion and production readiness from repository evidence, puts an
            honest planning number on the portfolio, then opens draft PRs and iterates until a target —
            or a safe stop.
          </p>
          <div className="na-slam-3">
            <Link href="/auth" data-testid="button-cta-hero" className="na-btn">
              Connect GitHub &amp; Analyze
            </Link>
          </div>
        </div>

        <div className="na-slam-photo relative">
          <img
            src="https://media.base44.com/images/public/6b006b03970f606f18f9a372/b2f0148cb_generated_099dcb6e.jpg"
            alt="Rusted toolbox opened on concrete"
            className="block aspect-[4/5] w-full border-4 border-foreground object-cover shadow-[14px_14px_0_#FF4D2E]"
          />
          <div className="na-badge">Draft PRs only</div>
        </div>
      </section>

      <div className="na-marquee">
        <div className="na-marquee-track">
          {[0, 1, 2].map((group) =>
            MARQUEE_ITEMS.map((item) => <span key={`${group}-${item}`}>{item}</span>),
          )}
        </div>
      </div>

      <section className="grid items-center gap-12 border-y-[3px] border-[#0A0A0A] bg-[#F5F1E8] px-5 py-16 text-[#0A0A0A] sm:px-12 lg:grid-cols-[1fr_420px]">
        <div>
          <h2 className="mb-11 text-[40px] leading-none sm:text-[64px]">
            <b className="bg-[#FF4D2E] px-3 font-normal text-[#0A0A0A] shadow-[6px_6px_0_#0A0A0A]">
              How a repo actually gets finished
            </b>
          </h2>
          <div className="grid gap-[22px] sm:grid-cols-2">
            {STEPS.map((step) => (
              <div key={step.title} className="na-stub">
                <div className="na-ic">{step.icon}</div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <img
            src="https://media.base44.com/images/public/6b006b03970f606f18f9a372/2f116a648_generated_ccf811b6.jpg"
            alt="Crumpled receipt still life"
            className="block aspect-[4/3] w-full rotate-[2deg] border-4 border-[#0A0A0A] object-cover shadow-[12px_12px_0_#9B5CFF]"
          />
        </div>
      </section>

      <div className="na-marquee na-marquee--purple">
        <div className="na-marquee-track">
          {[0, 1, 2, 3, 4].map((group) =>
            REVERSE_MARQUEE_ITEMS.map((item) => <span key={`${group}-${item}`}>{item}</span>),
          )}
        </div>
      </div>

      <section className="px-5 py-16 sm:px-12">
        <h2 className="mb-11 text-[40px] leading-none sm:text-[64px]">What you can do</h2>
        <div className="grid gap-[26px] md:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <div key={capability.tag} className="na-ticket">
              <span className="na-tag">{capability.tag}</span>
              <h3>{capability.title}</h3>
              <p>{capability.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-11">
          <img
            src="https://media.base44.com/images/public/6b006b03970f606f18f9a372/e8ca75fe4_generated_ccd4aacb.jpg"
            alt="Neon arrow sign"
            className="block aspect-[16/5] w-full border-4 border-foreground object-cover shadow-[12px_12px_0_#9B5CFF]"
          />
        </div>
      </section>

      <section className="border-t-[3px] border-foreground bg-primary px-5 py-24 text-center text-[#0A0A0A] sm:px-12">
        <h2 className="mx-auto mb-6 max-w-[900px] text-[46px] leading-none sm:text-[92px]">
          Your unfinished repos still count
        </h2>
        <p className="mx-auto mb-[34px] max-w-[640px] text-lg font-bold leading-relaxed">
          Connect GitHub, pick a model in Settings, run analysis, then finish until the scorecard moves.
        </p>
        <Link
          href="/auth"
          data-testid="button-cta-footer"
          className="na-btn na-btn--ink px-10 py-4 text-[26px]"
        >
          Get Started Free
        </Link>
      </section>

      <footer className="border-t-[3px] border-foreground bg-background px-5 py-[26px] text-center text-[13px] uppercase tracking-[2px] text-foreground sm:px-12">
        {BRAND.name} · Draft PRs only · Automatic merge disabled
      </footer>
    </div>
  );
}
