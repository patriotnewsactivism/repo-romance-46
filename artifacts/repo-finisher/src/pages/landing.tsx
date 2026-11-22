import { Link } from 'wouter';
import { BRAND } from '@/lib/brand';

const TRUST_POINTS = [
  'Draft PRs only',
  'Automatic merge disabled',
  'Honest portfolio numbers',
  'Evidence ceiling',
];

const STEPS = [
  {
    index: '01',
    title: 'Inspect',
    body: 'Read the tree, tests, CI, docs, and intended product from current GitHub evidence — not from a vibe.',
  },
  {
    index: '02',
    title: 'Score',
    body: 'Completion and readiness with an evidence ceiling. Present value is replacement cost. Potential is a labeled scenario.',
  },
  {
    index: '03',
    title: 'Draft PR',
    body: 'Exact-plan writes on an isolated branch. Automatic merge stays off. Failed CI can get bounded repair.',
  },
  {
    index: '04',
    title: 'Iterate',
    body: 'Finish until target re-scores after each pass and stops when the target, budget, or evidence ceiling says stop.',
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

const READOUT = [
  { label: 'Completion', value: '68', unit: '%', width: '68%' },
  { label: 'Production readiness', value: '41', unit: '%', width: '41%' },
  { label: 'Demand', value: '72', unit: '/100', width: '72%' },
];

const VALUATION = [
  { label: 'Present value', value: '$12.4k', note: 'replacement cost' },
  { label: 'Potential', value: '$31.0k', note: 'labeled scenario' },
];

const PRIMARY_BTN =
  'inline-flex h-11 items-center justify-center rounded-[3px] border border-[#4C8DFF] bg-[#4C8DFF] px-5 text-[14px] font-semibold text-[#07090A] transition-[filter,box-shadow] duration-150 hover:brightness-[1.08] active:brightness-125 active:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4C8DFF]';

const SECONDARY_BTN =
  'inline-flex h-11 items-center justify-center rounded-[3px] border border-[#2A3236] bg-[#14181A] px-5 text-[14px] font-medium text-[#E8ECEE] transition-colors duration-150 hover:border-[#3A4549] hover:bg-[#1A2023] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4C8DFF]';

const KICKER = 'font-mono text-[11px] uppercase tracking-[0.18em] text-[#6B7A80]';
const BODY = 'text-[13.5px] leading-[1.65] text-[#9AA6AB]';

export default function Landing() {
  return (
    <div className="cs-scope dark min-h-screen bg-[#0E1113] text-[#E8ECEE]">
      <header className="sticky top-0 z-50 border-b border-[#2A3236] bg-[#0E1113]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4C8DFF]"
          >
            <span aria-hidden className="block h-[18px] w-[18px] rounded-[3px] bg-[#4C8DFF]" />
            <span className="text-[16px] font-semibold tracking-[-0.01em] text-[#E8ECEE]">{BRAND.name}</span>
          </Link>

          <nav className="flex items-center gap-2" aria-label="Primary">
            <a
              href="#method"
              className="hidden rounded-[3px] px-3 py-2 text-[13px] text-[#9AA6AB] transition-colors duration-150 hover:text-[#E8ECEE] sm:inline-flex"
            >
              Method
            </a>
            <a
              href="#capabilities"
              className="hidden rounded-[3px] px-3 py-2 text-[13px] text-[#9AA6AB] transition-colors duration-150 hover:text-[#E8ECEE] sm:inline-flex"
            >
              Capabilities
            </a>
            <Link
              href="/auth"
              data-testid="button-signin"
              className="rounded-[3px] px-3 py-2 text-[13px] text-[#9AA6AB] transition-colors duration-150 hover:text-[#E8ECEE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4C8DFF]"
            >
              Sign in
            </Link>
            <Link href="/auth" className={`${PRIMARY_BTN} hidden sm:inline-flex`}>
              Connect GitHub
            </Link>
          </nav>
        </div>
      </header>

      <section className="border-b border-[#2A3236]">
        <div className="mx-auto grid max-w-[1180px] items-start gap-14 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:pb-24 lg:pt-20">
          <div className="animate-[cold-steel-in_0.6s_ease-out_both]">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#4C8DFF]">
              Repository intelligence
            </p>
            <h1 className="mt-5 text-[42px] font-semibold leading-[1.03] tracking-[-0.035em] text-[#E8ECEE] sm:text-[58px]">
              Inspect the graveyard.
              <span className="mt-2 block text-[#6B7A80]">Finish what is actually there.</span>
            </h1>
            <p className="mt-7 max-w-[560px] text-[15px] leading-[1.65] text-[#9AA6AB]">
              {BRAND.name} scores completion and production readiness from repository evidence, puts an honest
              planning number on the portfolio, then opens draft PRs and iterates until a target — or a safe stop.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/auth" data-testid="button-cta-hero" className={PRIMARY_BTN}>
                Connect GitHub &amp; analyze
              </Link>
              <a href="#method" className={SECONDARY_BTN}>
                See the method
              </a>
            </div>
            <p className="mt-6 font-mono text-[11px] leading-[1.7] text-[#6B7A80]">
              Read-only until you approve a branch. Draft PRs only — never an automatic merge.
            </p>
          </div>

          <div className="animate-[cold-steel-in_0.7s_0.1s_ease-out_both] rounded-[3px] border border-[#2A3236] bg-[#14181A] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between border-b border-[#2A3236] pb-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6B7A80]">
                Example readout
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#4C8DFF]">Scored</span>
            </div>

            <p className="mt-4 font-mono text-[12.5px] text-[#E8ECEE]">acme/checkout-service</p>

            <div className="mt-5 space-y-4">
              {READOUT.map((row) => (
                <div key={row.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] text-[#9AA6AB]">{row.label}</span>
                    <span className="font-mono text-[13px] tabular-nums text-[#E8ECEE]">
                      {row.value}
                      <span className="text-[#6B7A80]">{row.unit}</span>
                    </span>
                  </div>
                  <div className="mt-2 h-[3px] w-full bg-[#202729]">
                    <div className="h-full bg-[#4C8DFF]" style={{ width: row.width }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 border-t border-[#2A3236] pt-4">
              {VALUATION.map((row) => (
                <div key={row.label}>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6B7A80]">{row.label}</p>
                  <p className="mt-1.5 text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-[#E8ECEE]">
                    {row.value}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-[#6B7A80]">{row.note}</p>
                </div>
              ))}
            </div>

            <p className="mt-4 border-t border-[#2A3236] pt-3 font-mono text-[10px] leading-[1.6] text-[#6B7A80]">
              Evidence ceiling 72% · numbers are a planning aid, not a guarantee.
            </p>
          </div>
        </div>
      </section>

      <div className="border-b border-[#2A3236] bg-[#0C0F11]">
        <div className="mx-auto grid max-w-[1180px] grid-cols-2 divide-y divide-[#2A3236] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {TRUST_POINTS.map((point) => (
            <div
              key={point}
              className="flex items-center gap-2.5 px-5 py-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6B7A80] sm:px-6"
            >
              <span aria-hidden className="block h-1.5 w-1.5 shrink-0 bg-[#4C8DFF]" />
              {point}
            </div>
          ))}
        </div>
      </div>

      <section id="method" className="border-b border-[#2A3236]">
        <div className="mx-auto max-w-[1180px] px-5 py-16 sm:px-8 lg:py-20">
          <p className={KICKER}>Method</p>
          <h2 className="mt-3 max-w-[720px] text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-[#E8ECEE] sm:text-[38px]">
            How a repo actually gets finished
          </h2>

          <div className="mt-10 grid gap-px bg-[#2A3236] sm:grid-cols-2">
            {STEPS.map((step) => (
              <div key={step.index} className="bg-[#0E1113] p-6 sm:p-7">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] tabular-nums text-[#4C8DFF]">{step.index}</span>
                  <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#E8ECEE]">{step.title}</h3>
                </div>
                <p className={`mt-3 max-w-[440px] ${BODY}`}>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="capabilities" className="border-b border-[#2A3236]">
        <div className="mx-auto max-w-[1180px] px-5 py-16 sm:px-8 lg:py-20">
          <p className={KICKER}>Capabilities</p>
          <h2 className="mt-3 text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-[#E8ECEE] sm:text-[38px]">
            What you can do
          </h2>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {CAPABILITIES.map((capability) => (
              <div
                key={capability.tag}
                className="rounded-[3px] border border-[#2A3236] bg-[#14181A] p-6 transition-colors duration-200 hover:border-[#3A4549]"
              >
                <span className="inline-block rounded-[2px] border border-[#2A3236] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#4C8DFF]">
                  {capability.tag}
                </span>
                <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-[#E8ECEE]">
                  {capability.title}
                </h3>
                <p className={`mt-2.5 ${BODY}`}>{capability.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#2A3236]">
        <div className="mx-auto max-w-[1180px] px-5 py-16 sm:px-8 lg:py-20">
          <div className="rounded-[3px] border border-[#2A3236] bg-[#14181A] px-6 py-12 text-center sm:px-12">
            <h2 className="mx-auto max-w-[720px] text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-[#E8ECEE] sm:text-[40px]">
              Your unfinished repos still count
            </h2>
            <p className="mx-auto mt-4 max-w-[560px] text-[14px] leading-[1.65] text-[#9AA6AB]">
              Connect GitHub, pick a model in Settings, run analysis, then finish until the scorecard moves.
            </p>
            <div className="mt-8 flex justify-center">
              <Link href="/auth" data-testid="button-cta-footer" className={PRIMARY_BTN}>
                Get started free
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1180px] flex-col items-center justify-between gap-2 px-5 py-6 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6B7A80] sm:flex-row sm:px-8">
        <span>
          {BRAND.name} · {BRAND.tagline}
        </span>
        <span>Draft PRs only · automatic merge disabled</span>
      </footer>
    </div>
  );
}
