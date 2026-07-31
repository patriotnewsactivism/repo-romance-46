import { useEffect, useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useGetPreferences, useUpdatePreferences, getGetPreferencesQueryKey, useDisconnectGithub, useGetGithubStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getSession, signOut } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { GitBranch, ArrowLeft, Zap, Gauge, Brain, LogOut } from 'lucide-react';
import { toast } from 'sonner';

export default function Settings() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: preferences, isLoading } = useGetPreferences();
  const { data: githubStatus } = useGetGithubStatus();
  const updatePreferences = useUpdatePreferences();
  const disconnectGithub = useDisconnectGithub();

  const [aiProvider, setAiProvider] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [analysisTier, setAnalysisTier] = useState<'fast' | 'balanced' | 'deep'>('balanced');
  const [filterLanguages, setFilterLanguages] = useState('');
  const [excludeArchived, setExcludeArchived] = useState(true);
  const [minStars, setMinStars] = useState('0');
  const [maxRepos, setMaxRepos] = useState('');

  useEffect(() => {
    getSession().then(session => {
      if (!session) {
        setLocation('/auth');
      }
    });
  }, [setLocation]);

  useEffect(() => {
    if (preferences) {
      setAiProvider(preferences.custom_ai_provider || '');
      setAiKey(preferences.custom_ai_key || '');
      setAnalysisTier(preferences.analysis_tier || 'balanced');
      setFilterLanguages(preferences.filter_languages?.join(', ') || '');
      setExcludeArchived(preferences.filter_exclude_archived ?? true);
      setMinStars(String(preferences.filter_min_stars || 0));
      setMaxRepos(preferences.filter_max_repos ? String(preferences.filter_max_repos) : '');
    }
  }, [preferences]);

  const handleSave = () => {
    const languagesArray = filterLanguages
      .split(',')
      .map(l => l.trim())
      .filter(Boolean);

    updatePreferences.mutate(
      {
        data: {
          custom_ai_provider: aiProvider || undefined,
          custom_ai_key: aiKey || null,
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
          queryClient.invalidateQueries({ queryKey: getGetPreferencesQueryKey() });
        },
        onError: (error) => {
          toast.error('Failed to save settings', { description: error.message });
        }
      }
    );
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
      description: 'Single AI model, quickest results',
      detail: 'No profiling or critique steps — straight to synthesis'
    },
    {
      value: 'balanced',
      icon: Gauge,
      title: 'Balanced',
      description: 'Reasoning models for strategy, best for most users',
      detail: 'Profile → Critique → Synthesize with optimized models'
    },
    {
      value: 'deep',
      icon: Brain,
      title: 'Deep',
      description: 'Most powerful models, extended thinking',
      detail: 'Claude extended thinking or o3 for maximum insight'
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
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <Link href="/dashboard">
                <Button variant="ghost" size="sm" data-testid="button-back">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Dashboard
                </Button>
              </Link>
              <div className="h-6 w-px bg-border" />
              <div className="flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-primary" />
                <span className="font-semibold">Settings</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* GitHub Connection */}
        <Card>
          <CardHeader>
            <CardTitle>GitHub Connection</CardTitle>
            <CardDescription>Manage your GitHub account connection</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {githubStatus?.connected && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img 
                    src={githubStatus.avatarUrl || ''} 
                    alt={githubStatus.login || ''} 
                    className="w-10 h-10 rounded-full"
                  />
                  <div>
                    <div className="font-semibold">{githubStatus.displayName || githubStatus.login}</div>
                    <div className="text-sm text-muted-foreground">@{githubStatus.login}</div>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  onClick={handleDisconnect}
                  disabled={disconnectGithub.isPending}
                  data-testid="button-disconnect"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Disconnect
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Analysis Tier */}
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
                    onClick={() => setAnalysisTier(tier.value as any)}
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

        {/* AI Provider */}
        <Card>
          <CardHeader>
            <CardTitle>AI Provider</CardTitle>
            <CardDescription>Configure custom AI provider (optional)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-provider">Provider</Label>
              <Select value={aiProvider} onValueChange={setAiProvider}>
                <SelectTrigger id="ai-provider" data-testid="select-ai-provider">
                  <SelectValue placeholder="Default (GitHub Models)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Default (GitHub Models)</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {aiProvider && (
              <div className="space-y-2">
                <Label htmlFor="ai-key">API Key</Label>
                <Input
                  id="ai-key"
                  type="password"
                  value={aiKey}
                  onChange={(e) => setAiKey(e.target.value)}
                  placeholder="sk-..."
                  data-testid="input-ai-key"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Repository Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Repository Filters</CardTitle>
            <CardDescription>Control which repos are included in analysis</CardDescription>
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
              <p className="text-xs text-muted-foreground">
                Leave empty to include all languages
              </p>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="exclude-archived" className="cursor-pointer">
                <div className="font-semibold mb-1">Exclude archived repos</div>
                <div className="text-sm text-muted-foreground">
                  Don't analyze archived repositories
                </div>
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
                <Label htmlFor="max-repos">Max repositories</Label>
                <Input
                  id="max-repos"
                  type="number"
                  min="1"
                  value={maxRepos}
                  onChange={(e) => setMaxRepos(e.target.value)}
                  placeholder="No limit"
                  data-testid="input-max-repos"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
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
