import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { generateMergeInstructions } from "@/lib/analysis.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GitMerge, Loader2, Copy, Terminal, ArrowRight } from "lucide-react";
import { toast } from "sonner";

interface MergeResult {
  instructions: string;
  newRepoName: string;
  newRepoUrl: string;
  primaryRepo: string;
  mergedRepos: string[];
}

export function MergeInstructions({
  analysisId,
  itemRank,
}: {
  analysisId: string;
  itemRank: number;
}) {
  const fn = useServerFn(generateMergeInstructions);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [open, setOpen] = useState(false);

  const mut = useMutation({
    mutationFn: () => fn({ data: { analysisId, itemRank } }),
    onSuccess: (data) => {
      setResult(data as unknown as MergeResult);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="pt-2 border-t border-border">
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !result && !mut.isPending) mut.mutate();
        }}
        className="text-xs font-mono text-muted-foreground hover:text-foreground flex items-center gap-1.5"
      >
        <GitMerge className="h-3.5 w-3.5" />
        {open ? "▾ hide merge plan" : "▸ generate merge plan"}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {mut.isPending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> generating merge instructions…
            </div>
          )}

          {result && (
            <>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground font-mono">new repo:</span>
                <code className="font-mono text-primary">{result.newRepoUrl}</code>
              </div>

              <Card className="p-0 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
                  <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                    <Terminal className="h-3.5 w-3.5" /> merge_plan.sh
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => {
                      navigator.clipboard.writeText(result.instructions);
                      toast.success("Merge plan copied to clipboard");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <pre className="p-3 text-xs font-mono overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap">
                  {result.instructions}
                </pre>
              </Card>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">primary:</span>
                <code className="font-mono">{result.primaryRepo}</code>
                <ArrowRight className="h-3 w-3" />
                <span className="font-mono">merge:</span>
                {result.mergedRepos.map((r) => (
                  <code key={r} className="font-mono">
                    {r}
                  </code>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
