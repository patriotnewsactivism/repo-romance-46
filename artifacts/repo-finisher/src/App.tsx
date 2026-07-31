import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster as SonnerToaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { setAuthTokenGetter } from '@workspace/api-client-react';
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
