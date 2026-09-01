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
  Save,
} from 'lucide-react';
import { toast } from 'sonner';

type CredentialSource = 'byok' | 'platform' | 'none';
type AiProvider = 'google' | 'openai' | 'anthropic' | 'openrouter';

interface AiProviderStatus {
  active_provider: string;
  active_model: string | null;
  configured: boolean;
  credential_source: CredentialSource;
  stored_key_set: boolean;
  requested_provider: string;
  requested_model: string | null;
  platform_default: string;
  providers: {
    google: { platformConfigured: boolean };
    openai: { platformConfigured: boolean };
    anthropic: { platformConfigured: boolean };
    openrouter: { platformConfigured: boolean };
  };
}

interface AiSaveResult extends AiProviderStatus {
  saved: boolean;
}

interface AiTestResult {
  ok: boolean;
  provider: string;
  model: string | null;
  credential_source: CredentialSource;
  latency_ms: number;
}

function normalizeProvider(provider: string | null | undefined): AiProvider {
  switch ((provider || '').toLowerCase()) {
    case 'openai': return 'openai';
    case 'anthropic': return 'anthropic';
    case 'openrouter': return 'openrouter';
    case 'google':
    default:
      return 'google';
  }
}

function providerLabel(provider: string) {
  switch (provider) {
    case 'google': return 'Google Gemini';
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic';
    case 'openrouter': return 'OpenRouter';
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

function modelPlaceholder(provider: AiProvider) {
  switch (provider) {
    case 'openrouter': return 'openrouter/auto or provider/model-slug';
    case 'google': return 'gemini-3.7-flash (leave blank for default)';
    case 'openai': return 'Leave blank for platform default';
    case 'anthropic': return 'Leave blank for platform default';
  }
}

const MODEL_CATALOG: Record<AiProvider, Array<{ id: string; label: string; detail: string }>> = {
  openrouter: [
    { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol', detail: 'Highest-capability coding and repository-finishing agent' },
    { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra', detail: 'Strong balanced agent for broad portfolio work' },
    { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', detail: 'Fast, economical agent for routine analysis' },
    { id: 'deepseek/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash', detail: 'High-value reasoning and coding default' },
    { id: 'google/gemini-3.7-pro', label: 'Gemini 3.7 Pro', detail: 'Deep reasoning and long-context repository review' },
    { id: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash', detail: 'Fast long-context analysis' },
    { id: 'anthropic/claude-opus-4.1', label: 'Claude Opus 4.1', detail: 'Premium architecture and code review' },
    { id: 'openrouter/auto', label: 'OpenRouter Auto', detail: 'Provider-managed model routing' },
  ],
  google: [
    { id: 'gemini-3.7-pro', label: 'Gemini 3.7 Pro', detail: 'Deep reasoning and long-context repository review' },
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', detail: 'Fast long-context analysis' },
  ],
  openai: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', detail: 'Highest-capability coding and repository-finishing agent' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', detail: 'Strong balanced agent for broad portfolio work' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', detail: 'Fast, economical agent for routine analysis' },
  ],
  anthropic: [
    { id: 'claude-opus-4.1', label: 'Claude Opus 4.1', detail: 'Premium architecture and code review' },
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', detail: 'Balanced implementation and review' },
  ],
};

export default function Settings() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: preferences, isLoading } = useGetPreferences();
  const { data: githubStatus } = useGetGithubStatus();
  const updatePreferences = useUpdatePreferences();
  const disconnectGithub = useDisconnectGithub();

  const [aiProvider, setAiProvider] = useState<AiProvider>('google');
  const [aiModel, setAiModel] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiStatus, setAiStatus] = useState<AiProviderStatus | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(false);
  const [aiStatusError, setAiStatusError] = useState<string | null>(null);
  const [savingAi, setSavingAi] = useState(false);
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
      setAiProvider(normalizeProvider(preferences.custom_ai_provider));
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
      setAiProvider(normalizeProvider(status.requested_provider || status.active_provider));
      setAiModel(status.requested_model || '');
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
    const languagesArray = filterLanguages
      .split(',')
      .map(l => l.trim())
      .filter(Boolean);

    updatePreferences.mutate(
      {
        data: {
          analysis_tier: analysisTier,
          filter_languages: languagesArray.length > 0 ? languagesArray : undefined,
          filter_exclude_archived: excludeArchived,
          filter_min_stars: Number(minStars) || undefined,
          filter_max_repos: maxRepos ? Number(maxRepos) : undefined,
        }
      },
      {
        onSuccess: () => {
          toast.success('Repository settings saved');
          queryClient.invalidateQueries({ queryKey: getGetPreferencesQueryKey() });
        },
        onError: (error) => {
          toast.error('Failed to save repository settings', { description: error.message });
        }
      }
    );
  };

  const handleSaveAiProvider = async () => {
    setSavingAi(true);
    try {
      const saved = await customFetch<AiSaveResult>('/api/preferences/ai', {
        method: 'PATCH',
        responseType: 'json',
        body: JSON.stringify({
          provider: aiProvider,
          model: aiModel.trim() || null,
          ...(aiKey.trim() ? { api_key: aiKey.trim() } : {}),
        }),
      });
      setAiStatus(saved);
      setAiProvider(normalizeProvider(saved.requested_provider || saved.active_provider));
      setAiModel(saved.requested_model || '');
      setAiKey('');
      await queryClient.invalidateQueries({ queryKey: getGetPreferencesQueryKey() });
      toast.success(`${providerLabel(saved.active_provider)} settings saved`, {
        description: saved.configured
          ? `${credentialLabel(saved.credential_source)}${saved.active_model ? ` · ${saved.active_model}` : ''}`
          : 'Settings were saved, but this provider still needs a usable credential.',
      });
    } catch (error) {
      toast.error('Failed to save AI provider', {
        description: error instanceof Error ? error.message : 'The AI provider settings could not be saved.',
      });
    } finally {
      setSavingAi(false);
    }
  };

  const handleClearAiKey = async () => {
    setSavingAi(true);
    try {
      const saved = await customFetch<AiSaveResult>('/api/preferences/ai', {
        method: 'PATCH',
        responseType: 'json',
        body: JSON.stringify({
          provider: aiProvider,
          model: aiModel.trim() || null,
          clear_key: true,
        }),
      });
      setAiStatus(saved);
      setAiKey('');
      await queryClient.invalidateQueries({ queryKey: getGetPreferencesQueryKey() });
      toast.success('Stored API key removed');
    } catch (error) {
      toast.error('Failed to remove stored API key', {
        description: error instanceof Error ? error.message : 'The stored key could not be removed.',
      });
    } finally {
      setSavingAi(false);
    }
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
        description: `${credentialLabel(result.credential_source)}${result.model ? ` · ${result.model}` : ''} · ${result.latency_ms} ms`,
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

  const aiHasUnsavedChanges = Boolean(
    aiKey.trim() ||
    (aiStatus && normalizeProvider(aiStatus.requested_provider) !== aiProvider) ||
    (aiStatus && (aiStatus.requested_model || '') !== aiModel.trim())
  );
  const catalogModels = MODEL_CATALOG[aiProvider];
  const selectedCatalogModel = catalogModels.some((model) => model.id === aiModel) ? aiModel : '__custom__';

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
                  {githubStatus.avatarUrl ? (
                    <img
                      src={githubStatus.avatarUrl}
                      alt={githubStatus.login || ''}
                      className="w-10 h-10 rounded-full shrink-0"
                      onError={(event) => { event.currentTarget.style.display = 'none'; }}
                    />
                  ) : null}
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
            <CardTitle>AI Provider & Model</CardTitle>
            <CardDescription>
              Pick a capable model from the catalog; manual model IDs are optional, not required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ai-provider">Provider</Label>
                <Select value={aiProvider} onValueChange={(value) => {
                  setAiProvider(value as AiProvider);
                  setAiModel('');
                }}>
                  <SelectTrigger id="ai-provider" data-testid="select-ai-provider">
                    <SelectValue placeholder="Google Gemini" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="google">Google Gemini</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-model">Model preset</Label>
                <Select value={aiModel ? selectedCatalogModel : '__default__'} onValueChange={(value) => setAiModel(value === '__default__' || value === '__custom__' ? '' : value)}>
                  <SelectTrigger id="ai-model" data-testid="select-ai-model">
                    <SelectValue placeholder="Choose a model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Platform default (recommended)</SelectItem>
                    {catalogModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>{model.label} — {model.detail}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder={`Optional custom override: ${modelPlaceholder(aiProvider)}`}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  data-testid="input-ai-model"
                />
                <p className="text-xs text-muted-foreground">
                  Sol and Terra are available as first-class presets. Custom entry remains available for newly released provider models.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">BYOK API Key</Label>
              <Input
                id="ai-key"
                type="password"
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                placeholder={aiStatus?.stored_key_set || preferences?.custom_ai_key_set ? 'A key is stored — type to replace it' : 'Optional provider API key'}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                data-testid="input-ai-key"
              />
              <p className="text-xs text-muted-foreground">
                {aiStatus?.stored_key_set || preferences?.custom_ai_key_set
                  ? 'The key is write-only and encrypted at rest. Leaving this blank keeps it unless you switch providers.'
                  : 'If the Render API has a platform credential for this provider, BYOK is optional. A key entered here is encrypted before storage.'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleSaveAiProvider}
                disabled={savingAi}
                data-testid="button-save-ai-provider"
              >
                {savingAi ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                {savingAi ? 'Saving AI settings…' : 'Save AI Provider'}
              </Button>
              {(aiStatus?.stored_key_set || preferences?.custom_ai_key_set) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClearAiKey}
                  disabled={savingAi}
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
                    {aiHasUnsavedChanges && <Badge variant="outline">Unsaved changes</Badge>}
                  </div>
                  {aiStatus ? (
                    <p className="text-sm text-muted-foreground mt-1 break-words">
                      {providerLabel(aiStatus.active_provider)} · {credentialLabel(aiStatus.credential_source)}
                      {aiStatus.active_model ? ` · ${aiStatus.active_model}` : ''}
                    </p>
                  ) : aiStatusError ? (
                    <p className="text-sm text-destructive mt-1 break-words">{aiStatusError}</p>
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
                  disabled={testingAi || !aiStatus?.configured || aiHasUnsavedChanges}
                  data-testid="button-test-ai-provider"
                >
                  {testingAi && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {testingAi ? 'Testing…' : aiHasUnsavedChanges ? 'Save before testing' : 'Test provider'}
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
            <CardDescription>Analyze a selected limit or every accessible repository in one portfolio run.</CardDescription>
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
                <Label htmlFor="max-repos">Portfolio scope</Label>
                <Select value={maxRepos || '1000'} onValueChange={setMaxRepos}>
                  <SelectTrigger id="max-repos" data-testid="select-max-repos"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50 repositories</SelectItem>
                    <SelectItem value="100">100 repositories</SelectItem>
                    <SelectItem value="250">250 repositories</SelectItem>
                    <SelectItem value="500">500 repositories</SelectItem>
                    <SelectItem value="1000">All accessible repositories (up to 1,000)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Choose All to include your complete 230-repository portfolio; Luna does not impose a 90-repository product limit.</p>
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
            {updatePreferences.isPending ? 'Saving...' : 'Save Repository Settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}
