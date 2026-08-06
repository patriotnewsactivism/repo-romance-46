import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster as SonnerToaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import { supabase } from '@/integrations/supabase/client';

import Landing from '@/pages/landing';
import Auth from '@/pages/auth';
import AuthCallback from '@/pages/auth-callback';
import Dashboard from '@/pages/dashboard';
import AnalysisDetail from '@/pages/analysis-detail';
import Settings from '@/pages/settings';
import SharedAnalysis from '@/pages/shared-analysis';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: false,
    },
  },
});

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
    // The frontend (static SPA) and api-server are deployed as separate
    // services with separate origins on some hosts (e.g. Railway — each
    // service gets its own domain, and only the SPA is mapped to a custom
    // domain). Relative fetches like `/api/github/status` would otherwise
    // silently hit the SPA's own static server (which SPA-fallbacks to
    // index.html for any unmatched path) instead of the real backend —
    // returning HTML where JSON was expected. That failure was caught
    // non-fatally by callers, so features like "Connect GitHub" appeared to
    // work but never actually persisted, looping back to a disconnected
    // state every time. On Vercel, both are served from the same origin via
    // rewrites, so VITE_API_BASE_URL is simply unset there and this is a
    // no-op (relative paths already resolve correctly).
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (apiBaseUrl) {
      setBaseUrl(apiBaseUrl);
    }

    setAuthTokenGetter(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });

    // Auto dark mode
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <SonnerToaster position="top-right" theme="dark" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
