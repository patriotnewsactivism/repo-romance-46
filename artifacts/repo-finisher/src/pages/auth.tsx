import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { signInWithGitHub, getSession } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { SiGithub } from 'react-icons/si';
import { BRAND } from '@/lib/brand';

const PAGE_FONT = '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO_FONT = 'ui-monospace, Menlo, "Courier New", monospace';

const fieldWrap = 'cs-field';

const fieldInput =
  'h-10 w-full rounded-[3px] border border-[#2A3236] bg-[#14181A] px-3 text-[14px] text-[#E8ECEE] outline-none transition-[border-color,background] duration-200 placeholder:text-[#6B7A80] focus:border-[#2A3236] focus:bg-[#171C1F]';

const fieldLabel = 'text-[12px] font-semibold tracking-[0.01em] text-[#E8ECEE]';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4C8DFF]';

export default function Auth() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSession().then(session => {
      if (session) {
        setLocation('/dashboard');
      }
    });
  }, [setLocation]);

  const handleSignIn = async () => {
    await signInWithGitHub();
  };

  const handleEmailAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result =
      mode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setError(result.error.message);
      setBusy(false);
      return;
    }

    setLocation('/dashboard');
  };

  return (
    <div
      className="flex min-h-screen justify-center bg-[#0E1113] px-4 pb-[120px] pt-16 text-[#E8ECEE] animate-[cold-steel-in_0.6s_ease-out_both] [@media(min-height:1200px)]:pt-[360px]"
      style={{ fontFamily: PAGE_FONT }}
    >
      <div className="w-full max-w-[420px] self-start rounded-[4px] border border-[#2A3236] bg-[#0E1113] p-8 shadow-[0_0_0_1px_#0A0C0D,0_18px_40px_rgba(0,0,0,0.45)] animate-[cold-steel-in_0.7s_0.1s_ease-out_both]">
        <h1
          className="mb-2 mt-0 text-[22px] font-semibold normal-case leading-[1.2] tracking-[-0.02em] text-[#E8ECEE]"
          style={{ fontFamily: PAGE_FONT }}
        >
          Welcome to {BRAND.name}
        </h1>
        <p className="mb-6 mt-0 text-[14px] leading-[1.5] tracking-[-0.005em] text-[#6B7A80]">
          Sign in to analyze your portfolio and discover product opportunities.
        </p>

        <form onSubmit={handleEmailAuth} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className={fieldLabel}>
              Email
            </label>
            <div className={fieldWrap}>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="you@example.com"
                className={fieldInput}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className={fieldLabel}>
              Password
            </label>
            <div className={fieldWrap}>
              <input
                id="password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={8}
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                className={fieldInput}
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-[3px] border border-[#2A3236] border-l-2 border-l-[#4C8DFF] bg-[#14181A] px-3 py-2 text-[12px] leading-[1.5] text-[#E8ECEE]"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className={`mt-2 h-[42px] w-full rounded-[3px] border border-[#4C8DFF] bg-[#4C8DFF] text-[14px] font-semibold tracking-[-0.005em] text-[#07090A] transition-[filter,box-shadow] duration-150 hover:brightness-[1.08] active:brightness-125 active:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100 ${focusRing}`}
          >
            {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signup' ? 'signin' : 'signup');
              setError(null);
            }}
            className={`mt-1 w-full bg-transparent px-0 py-1.5 text-left text-[13px] text-[#6B7A80] underline decoration-[#2A3236] underline-offset-[3px] transition-colors duration-150 hover:text-[#E8ECEE] active:text-[#4C8DFF] ${focusRing}`}
          >
            {mode === 'signup' ? 'I already have an account' : 'Create an account instead'}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[12px] text-[#6B7A80]">
          <span className="h-px flex-1 bg-[#2A3236]" />
          or
          <span className="h-px flex-1 bg-[#2A3236]" />
        </div>

        <button
          type="button"
          onClick={handleSignIn}
          data-testid="button-github-signin"
          className={`flex h-[42px] w-full items-center justify-center gap-2.5 rounded-[3px] border border-[#2A3236] bg-[#14181A] text-[14px] font-medium text-[#E8ECEE] transition-[background,border-color,filter] duration-150 hover:border-[#3A4549] hover:bg-[#1A2023] active:brightness-[1.2] ${focusRing}`}
        >
          <SiGithub className="h-[18px] w-[18px] text-[#E8ECEE]" />
          Continue with GitHub
        </button>

        <p
          className="mb-0 mt-4 text-[11px] leading-[1.6] text-[#6B7A80]"
          style={{ fontFamily: MONO_FONT }}
        >
          GitHub access includes private repositories and write permission so {BRAND.name} can open
          draft PRs. It never merges automatically.
        </p>
      </div>
    </div>
  );
}
