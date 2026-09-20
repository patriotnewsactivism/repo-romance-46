import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Sigma } from "lucide-react";
import { PortfolioValuationV2Panel } from "@/components/portfolio-valuation-v2-panel";

export function ValuationView({ analysisId }: { analysisId: string }) {
  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Sigma className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">How this number is built</h3>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          RepoFinisher does not invent comparable acquisitions or TAM. Present value is replacement cost and traction-adjusted evidence. Potential value is a labeled planning scenario. Confidence, overlap, and synergy are applied after those repository-level ranges exist.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> Replacement cost</Badge>
          <Badge variant="outline">Confidence haircut</Badge>
          <Badge variant="outline">Overlap discount</Badge>
          <Badge variant="outline">Capped synergy</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Named competitors and customer pricing appear only when live research is configured. Without that evidence, saturation stays unknown instead of guessed.
        </p>
      </Card>
      <PortfolioValuationV2Panel analysisId={analysisId} />
    </div>
  );
}
