import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import {
  useGetPreferences,
  useUpdatePreferences,
  getGetPreferencesQueryKey,
  useDisconnectGithub,
  useGetGithubStatus,
  customFetch,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getSession, signOut } from '@/lib/auth';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Zap,
  Gauge,
  Brain,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

type CredentialSource = 'byok' | 'platform' | 'none';

interface AiProviderStatus {
  active_provider: string;
  configured: boolean;
  credential_source: CredentialSource;
  platform_default: string;
  providers: {
    google: { platformConfigured: boolean };
    openai: { platformConfigured: boolean };
    anthropic: { platformConfigured: boolean };
  };
}

interface AiTestResult {
  ok: boolean;
  provider: string;
  credential_source: CredentialSource;
  latency_ms: number;
}

function providerLabel(provider: string) {
  switch (provider) {
    case 'google': return 'Google Gemini';
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic';
    default: return provider || 'AI provider';
  }
}

function credentialLabel(source: CredentialSource) {
  switch (source) {
    case 'byok': return 'Stored BYOK credential';
    case 'platform': return 'Platform credential';
    default: return 'No usable credential';
  }
}

export default function Settings() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: preferences, isLoading } = useGetPreferences();
  const { data: githubStatus } = useGetGithubStatus();
  const updatePreferences = useUpdatePreferences();
  const disconnectGithub = useDisconnectGithub();

  const [aiProvider, setAiProvider] = useState('google');
  const [aiKey, setAiKey] = useState('');
  const [aiStatus, setAiStatus] = useState<AiProviderStatus | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(false);
  const [aiStatusError, setAiStatusError] = useState<string | null>(null);
  const [testingAi, setTestingAi] = useState(false);
  const [analysisTier, setAnalysisTier] = useState<'fast' | 'balanced' | 'deep'>('balanced');
  const [filterLanguages, setFilterLanguages] = useState('');
  const [excludeArchived, setExcludeArchived] = useState(true);
  const [minStars, setMinStars] = useState('0');
  const [maxRepos, setMaxRepos] = useState('');

  useEffect(() => {
    getSession().then(session => {
      if (!session) setLocation('/auth');
    });
  }, [setLocation]);

  useEffect(() => {
    if (preferences) {
      const savedProvider = preferences.custom_ai_provider || 'google';
      setAiProvider(savedProvider === 'github_models' ? 'google' : savedProvider);
      setAiKey('');
      setAnalysisTier(preferences.analysis_tier || 'balanced');
      setFilterLanguages(preferences.filter_languages?.join(', ') || '');
      setExcludeArchived(preferences.filter_exclude_archived ?? true);
      setMinStars(String(preferences.filter_min_stars || 0));
      setMaxRepos(preferences.filter_max_repos ? String(preferences.filter_max_repos) : '');
    }
  }, [preferences]);

  const loadAiStatus = async () => {
    setAiStatusLoading(true);
    setAiStatusError(null);
    try {
      const status = await customFetch<AiProviderStatus>('/api/preferences/ai-status', { responseType: 'json' });
      setAiStatus(status);
    } catch (error) {
      setAiStatusError(error instanceof Error ? error.message : 'Unable to read AI provider status');
    } finally {
      setAiStatusLoading(false);
    }
  };

  useEffect(() => {
    if (preferences) void loadAiStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences]);

  const handleSave = () => {
    const savedProvider = preferences?.custom_ai_provider === 'github_models'
      ? 'google'
      : (preferences?.custom_ai_provider || 'google');

    if (preferences?.custom_ai_key_set && aiProvider !== savedProvider && !aiKey) {
      toast.error('A BYOK key is already stored for the current provider', {
        description: 'Enter a replacement key for the new provider, or remove the stored key before switching providers.',
      });
      return;
    }

    const languagesArray = filterLanguages
      .split(',')
      .map(l => l.trim())
      .filter(Boolean);

    updatePreferences.mutate(
      {
        data: {
          custom_ai_provider: aiProvider,
          ...(aiKey ? { custom_ai_key: aiKey } : {}),
          analysis_tier: analysisTier,
          filter_languages: languagesArray.length > 0 ? languagesArray : undefined,
          filter_exclude_archived: excludeArchived,
          filter_min_stars: Number(minStars) || undefined,
          filter_max_repos: maxRepos ? Number(maxRepos) : undefined,
        }
      },
      {
        onSuccess: () => {
          toast.success('Settings saved');
          setAiKey('');
          queryClient.invalidateQueries({ queryKey: getGetPreferencesQueryKey() });
          void loadAiStatus();
        },
        onError: (error) => {
          toast.error('Failed to save settings', { description: error.message });
        }
      }
    );
  };

  const handleTestProvider = async () => {
    setTestingAi(true);
    try {
      const result = await customFetch<AiTestResult>('/api/preferences/ai-test', {
        method: 'POST',
        responseType: 'json',
        body: JSON.stringify({}),
      });
      toast.success(`${providerLabel(result.provider)} is ready`, {
        description: `${credentialLabel(result.credential_source)} · ${result.latency_ms} ms`,
      });
      await loadAiStatus();
    } catch (error) {
      toast.error('AI provider test failed', {
        description: error instanceof Error ? error.message : 'The provider did not pass the readiness check.',
      });
    } finally {
      setTestingAi(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect GitHub? This will sign you out.')) return;

    disconnectGithub.mutate(undefined, {
      onSuccess: async () => {
        await signOut();
        toast.success('Disconnected from GitHub');
        setLocation('/auth');
      },
      onError: (error) => {
        toast.error('Failed to disconnect', { description: error.message });
      }
    });
  };

  const tierCards = [
    {
      value: 'fast',
      icon: Zap,
      title: 'Fast',
      description: 'Quickest repository completion analysis',
      detail: 'Minimal strategy passes for rapid triage and completion planning'
    },
    {
      value: 'balanced',
      icon: Gauge,
      title: 'Balanced',
      description: 'Best balance of reasoning depth and runtime',
      detail: 'Profile → critique → synthesize with completion coverage checks'
    },
    {
      value: 'deep',
      icon: Brain,
      title: 'Deep',
      description: 'Maximum analysis depth for complex repositories',
      detail: 'More context, critique, and extended reasoning when the provider supports it'
    }
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background dark">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Skeleton className="h-8 w-48 mb-8" />
          <div className="space-y-6">
            <Skeleton className="h-64" />
            <Skeleton className="h-96" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background dark">
      <AppHeader
        section="Settings"
        user={githubStatus?.connected ? {
          login: githubStatus.login,
          displayName: githubStatus.displayName,
          avatarUrl: githubStatus.avatarUrl,
        } : null}
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>GitHub Connection</CardTitle>
            <CardDescription>Manage your GitHub account connection</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {githubStatus?.connected && (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={githubStatus.avatarUrl || ''}
                    alt={githubStatus.login || ''}
                    className="w-10 h-10 rounded-full shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{githubStatus.displayName || githubStatus.login}</div>
                    <div className="text-sm text-muted-foreground truncate">@{githubStatus.login}</div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={disconnectGithub.isPending}
                  data-testid="button-disconnect"
                  className="sm:shrink-0"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Disconnect
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Analysis Tier</CardTitle>
            <CardDescription>Choose the AI analysis depth for future runs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {tierCards.map(tier => {
                const Icon = tier.icon;
                const isSelected = analysisTier === tier.value;
                return (
                  <button
                    key={tier.value}
                    onClick={() => setAnalysisTier(tier.value as 'fast' | 'balanced' | 'deep')}
                    className={`p-4 border rounded-lg text-left transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40'
                    }`}
                    data-testid={`tier-${tier.value}`}
                  >
                    <Icon className={`w-6 h-6 mb-3 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                    <h3 className="font-semibold mb-1">{tier.title}</h3>
                    <p className="text-sm text-muted-foreground mb-2">{tier.description}</p>
                    <p className="text-xs text-muted-foreground">{tier.detail}</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Provider</CardTitle>
            <CardDescription>
              Google Gemini is the default. Use a platform credential or store your own encrypted BYOK key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-provider">Provider</Label>
              <Select value={aiProvider} onValueChange={setAiProvider}>
                <SelectTrigger id="ai-provider" data-testid="select-ai-provider">
                  <SelectValue placeholder="Google Gemini (default)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="google">Google Gemini (default)</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">BYOK API Key</Label>
              <Input
                id="ai-key"
                type="password"
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                placeholder={preferences?.custom_ai_key_set ? 'A key is stored — type to replace it' : 'Optional provider API key'}
                data-testid="input-ai-key"
              />
              <p className="text-xs text-muted-foreground">
                {preferences?.custom_ai_key_set
                  ? 'Your key is encrypted at rest and never sent back to the browser. Leave this blank to keep it.'
                  : 'If the platform has a credential for this provider, you do not need to supply one. BYOK keys are encrypted before storage.'}
              </p>
              {preferences?.custom_ai_key_set && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    updatePreferences.mutate(
                      { data: { custom_ai_key: null } },
                      {
                        onSuccess: () => {
                          toast.success('Stored API key removed');
                          queryClient.invalidateQueries({ queryKey: getGetPreferencesQueryKey() });
                          void loadAiStatus();
                        },
                      },
                    )
                  }
                  data-testid="button-clear-ai-key"
                >
                  Remove stored key
                </Button>
              )}
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-start gap-3">
                {aiStatusLoading ? (
                  <Loader2 className="w-5 h-5 mt-0.5 animate-spin text-muted-foreground" />
                ) : aiStatus?.configured ? (
                  <CheckCircle2 className="w-5 h-5 mt-0.5 text-emerald-500" />
                ) : (
                  <AlertTriangle className="w-5 h-5 mt-0.5 text-amber-500" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Provider readiness</span>
                    {aiStatus && (
                      <Badge variant="outline" className={aiStatus.configured ? 'text-emerald-500' : 'text-amber-500'}>
                        {aiStatus.configured ? 'Configured' : 'Missing credential'}
                      </Badge>
                    )}
                  </div>
                  {aiStatus ? (
                    <p className="text-sm text-muted-foreground mt-1">
                      {providerLabel(aiStatus.active_provider)} · {credentialLabel(aiStatus.credential_source)}
                    </p>
                  ) : aiStatusError ? (
                    <p className="text-sm text-destructive mt-1">{aiStatusError}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-1">Checking the active provider…</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestProvider}
                  disabled={testingAi || !aiStatus?.configured}
                  data-testid="button-test-ai-provider"
                >
                  {testingAi && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {testingAi ? 'Testing…' : 'Test provider'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadAiStatus()}
                  disabled={aiStatusLoading}
                >
                  Refresh status
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Repository Filters</CardTitle>
            <CardDescription>Analyze and value up to 500 repositories in a portfolio run.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="filter-languages">Languages (comma-separated)</Label>
              <Input
                id="filter-languages"
                value={filterLanguages}
                onChange={(e) => setFilterLanguages(e.target.value)}
                placeholder="e.g. TypeScript, Python, Go"
                data-testid="input-filter-languages"
              />
              <p className="text-xs text-muted-foreground">Leave empty to include all languages</p>
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="exclude-archived" className="cursor-pointer min-w-0">
                <div className="font-semibold mb-1">Exclude archived repos</div>
                <div className="text-sm text-muted-foreground">Don't analyze archived repositories</div>
              </Label>
              <Switch
                id="exclude-archived"
                checked={excludeArchived}
                onCheckedChange={setExcludeArchived}
                data-testid="switch-exclude-archived"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="min-stars">Minimum stars</Label>
                <Input
                  id="min-stars"
                  type="number"
                  min="0"
                  value={minStars}
                  onChange={(e) => setMinStars(e.target.value)}
                  data-testid="input-min-stars"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-repos">Max repositories (2–500)</Label>
                <Input
                  id="max-repos"
                  type="number"
                  min="2"
                  max="500"
                  value={maxRepos}
                  onChange={(e) => setMaxRepos(e.target.value)}
                  placeholder="200"
                  data-testid="input-max-repos"
                />
                <p className="text-xs text-muted-foreground">The old 30-repository valuation ceiling no longer applies.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={updatePreferences.isPending}
            size="lg"
            data-testid="button-save-settings"
          >
            {updatePreferences.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}
