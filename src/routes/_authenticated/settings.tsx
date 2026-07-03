import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Mail, Clock, Key, Filter, Star, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { getConnectionStatus, disconnectGithub } from "@/lib/github.functions";
import { getPreferences, updatePreferences, getStarredItems } from "@/lib/preferences.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const statusFn = useServerFn(getConnectionStatus);
  const disconnectFn = useServerFn(disconnectGithub);
  const prefFn = useServerFn(getPreferences);
  const updateFn = useServerFn(updatePreferences);
  const starredFn = useServerFn(getStarredItems);

  const status = useQuery({ queryKey: ["gh-status"], queryFn: () => statusFn() });
  const prefs = useQuery({ queryKey: ["prefs"], queryFn: () => prefFn() });
  const starred = useQuery({ queryKey: ["starred"], queryFn: () => starredFn() });

  // Local state for form
  const [emailNotif, setEmailNotif] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleFreq, setScheduleFreq] = useState<"weekly" | "monthly">("weekly");
  const [customProvider, setCustomProvider] = useState("lovable");
  const [customKey, setCustomKey] = useState("");
  const [filterLanguages, setFilterLanguages] = useState("");
  const [filterMinStars, setFilterMinStars] = useState(0);
  const [filterMaxRepos, setFilterMaxRepos] = useState(25);
  const [excludeArchived, setExcludeArchived] = useState(true);

  // Sync from server
  useEffect(() => {
    if (prefs.data) {
      const p = prefs.data as unknown as Record<string, unknown>;
      setEmailNotif(p.email_notifications as boolean);
      setScheduleEnabled(p.schedule_enabled as boolean);
      setScheduleFreq(p.schedule_frequency as "weekly" | "monthly");
      setCustomProvider((p.custom_ai_provider as string) || "lovable");
      setCustomKey("");
      setFilterLanguages(((p.filter_languages as string[]) || []).join(", "));
      setFilterMinStars((p.filter_min_stars as number) || 0);
      setExcludeArchived(p.filter_exclude_archived as boolean);
    }
  }, [prefs.data]);

  const updateMut = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          email_notifications: emailNotif,
          schedule_enabled: scheduleEnabled,
          schedule_frequency: scheduleFreq,
          custom_ai_provider: customProvider,
          ...(customKey ? { custom_ai_key: customKey } : {}),
          ...(customProvider === "github_models" ? { custom_ai_key: null } : {}),
          filter_languages: filterLanguages
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          filter_exclude_archived: excludeArchived,
          filter_min_stars: filterMinStars,
          filter_max_repos: filterMaxRepos,
        },
      }),
    onSuccess: () => {
      toast.success("Settings saved");
      prefs.refetch();
      setCustomKey(""); // Clear after save
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectFn(),
    onSuccess: () => {
      toast.success("GitHub disconnected");
      status.refetch();
    },
  });

  const connected = status.data?.connected;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 space-y-8">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <h1 className="font-mono text-3xl font-bold tracking-tight">
        <span className="text-primary">$</span> settings
      </h1>

      {/* Starred recommendations */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-sm font-semibold">Starred recommendations</h2>
        </div>
        {starred.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !starred.data?.length ? (
          <p className="text-sm text-muted-foreground">
            No starred recommendations yet. Star items from an analysis to track them here.
          </p>
        ) : (
          <div className="space-y-2">
            {(starred.data as Array<Record<string, unknown>>).map((item) => (
              <div key={item.id as string} className="rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {item.kind as string}
                  </Badge>
                  <span className="font-medium text-sm">{item.title as string}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.pitch as string}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Scheduled re-analysis */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-sm font-semibold">Scheduled re-analysis</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Automatically re-scan your GitHub portfolio on a schedule. New repos and changes will be
          picked up.
        </p>
        <div className="flex items-center justify-between">
          <Label htmlFor="schedule" className="text-sm">
            Enable scheduled analysis
          </Label>
          <Switch id="schedule" checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
        </div>
        {scheduleEnabled && (
          <div className="space-y-2">
            <Label className="text-sm">Frequency</Label>
            <div className="flex gap-2">
              {(["weekly", "monthly"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setScheduleFreq(f)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono border transition ${
                    scheduleFreq === f
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border bg-card hover:bg-accent"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            {Boolean((prefs.data as unknown as Record<string, unknown>)?.last_scheduled_run) && (
              <p className="text-xs text-muted-foreground font-mono">
                Last auto-run:{" "}
                {new Date(
                  (prefs.data as unknown as Record<string, unknown>).last_scheduled_run as string,
                ).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Email notifications */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-sm font-semibold">Email notifications</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Get an email when an analysis completes (including scheduled runs).
        </p>
        <div className="flex items-center justify-between">
          <Label htmlFor="email" className="text-sm">
            Enable email notifications
          </Label>
          <Switch id="email" checked={emailNotif} onCheckedChange={setEmailNotif} />
        </div>
      </Card>

      {/* BYOK: Bring Your Own AI Key */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-sm font-semibold">AI provider (BYOK)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Bring your own AI API key to use instead of the default Lovable gateway. Your key is
          stored securely and only used for your analyses.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Provider</Label>
            <select
              value={customProvider}
              onChange={(e) => setCustomProvider(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="lovable">Lovable Gateway (default)</option>
              <option value="github_models">
                GitHub Models — GPT-4o (free, uses your GitHub token)
              </option>
              <option value="openai">OpenAI (bring your own key)</option>
              <option value="anthropic">Anthropic / Claude (bring your own key)</option>
              <option value="google">Google / Gemini (bring your own key)</option>
            </select>
          </div>
          <div>
            <Label className="text-sm">
              API Key{" "}
              {(prefs.data as unknown as Record<string, unknown> | undefined)?.custom_ai_key
                ? "(saved — leave blank to keep)"
                : ""}
            </Label>
            <Input
              type="password"
              value={customKey}
              onChange={(e) => setCustomKey(e.target.value)}
              placeholder={
                prefs.data && (prefs.data as unknown as Record<string, unknown>).custom_ai_key
                  ? "••••••••••••"
                  : "sk-..."
              }
              className="mt-1 font-mono"
            />
          </div>
        </div>
      </Card>

      {/* Analysis filters */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-sm font-semibold">Analysis filters</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Control which repos are included in your analyses. Applied to all future runs.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-sm">
              Filter by languages (comma-separated, e.g. "TypeScript, Python")
            </Label>
            <Input
              value={filterLanguages}
              onChange={(e) => setFilterLanguages(e.target.value)}
              placeholder="All languages"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm">Minimum stars</Label>
            <Input
              type="number"
              min={0}
              value={filterMinStars}
              onChange={(e) => setFilterMinStars(parseInt(e.target.value) || 0)}
              className="mt-1"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Exclude archived repos</Label>
            <Switch checked={excludeArchived} onCheckedChange={setExcludeArchived} />
          </div>
        </div>
      </Card>

      {/* GitHub connection */}
      <Card className="p-6 space-y-4">
        <h2 className="font-mono text-sm font-semibold">GitHub connection</h2>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground font-mono">
            {connected ? `connected as ${status.data?.login}` : "not connected"}
          </span>
          {connected && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnectMut.mutate()}
              disabled={disconnectMut.isPending}
            >
              Disconnect
            </Button>
          )}
        </div>
      </Card>

      {/* Save button */}
      <div className="flex justify-end">
        <Button
          onClick={() => updateMut.mutate()}
          disabled={updateMut.isPending}
          className="glow-primary"
        >
          {updateMut.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" /> Save settings
            </>
          )}
        </Button>
      </div>
    </main>
  );
}
