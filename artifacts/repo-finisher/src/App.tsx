import { useEffect } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster as SonnerToaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import { supabase } from '@/integrations/supabase/client';
import { captureOperationalError, setSentryRoute, setSentryUser } from '@/lib/observability';

import Landing from '@/pages/landing';
import Auth from '@/pages/auth';
import AuthCallback from '@/pages/auth-callback';
import Dashboard from '@/pages/dashboard';
import AnalysisDetail from '@/pages/analysis-detail';
import Settings from '@/pages/settings';
import SharedAnalysis from '@/pages/shared-analysis';
import NotFound from '@/pages/not-found';

// Vercel serves the SPA; Railway serves the persistent API/worker plane.
// Ignore the retired Cloud Run URL even if a stale Vercel build variable still
// contains it, so production cannot silently route back to decommissioned compute.
const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, '');
const productionApiBaseUrl = 'https://repofinisher-api-production.up.railway.app';
const retiredApiBaseUrls = new Set([
  'https://repofinisher-api-z6kubh2jtq-uc.a.run.app',
]);
const canonicalProductionOrigin = 'https://portfolio.donmatthews.live';
const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);
const legacyProductionHostnames = new Set(['repofinisher.donmatthews.live']);
const isLocalBrowser = typeof window !== 'undefined' && localHostnames.has(window.location.hostname);

if (typeof window !== 'undefined' && legacyProductionHostnames.has(window.location.hostname)) {
  window.location.replace(
    `${canonicalProductionOrigin}${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

const apiBaseUrl =
  configuredApiBaseUrl && !retiredApiBaseUrls.has(configuredApiBaseUrl)
    ? configuredApiBaseUrl
    : isLocalBrowser
      ? undefined
      : productionApiBaseUrl;

if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

setAuthTokenGetter(async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => captureOperationalError(error, `query:${String(query.queryKey[0] ?? 'unknown')}`),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) =>
      captureOperationalError(error, `mutation:${String(mutation.options.mutationKey?.[0] ?? 'unknown')}`),
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: false,
    },
  },
});

function ObservabilityContext() {
  const [location] = useLocation();

  useEffect(() => {
    setSentryRoute(location);
  }, [location]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSentryUser(data.session?.user.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSentryUser(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/auth" component={Auth} />
      <Route path="/auth/callback" component={AuthCallback} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/analysis/:id" component={AnalysisDetail} />
      <Route path="/settings" component={Settings} />
      <Route path="/s/:slug" component={SharedAnalysis} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ObservabilityContext />
          <Router />
        </WouterRouter>
        <SonnerToaster position="top-right" theme="dark" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
