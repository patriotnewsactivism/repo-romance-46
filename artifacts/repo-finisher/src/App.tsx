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

// Configure the API client synchronously, before any route component can mount.
// AuthCallback persists Supabase's GitHub provider token immediately after the
// OAuth code exchange. If this setup lives in App's useEffect, a child route's
// effect can run first and POST /github/connect without a bearer token.
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
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
