function polar(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function needle(cx: number, cy: number, r: number, pct: number, color: string) {
  const tip = polar(cx, cy, r, Math.max(0, Math.min(100, pct)) * 1.8);
  return <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={color} strokeWidth="2.5" strokeLinecap="round" />;
}

export function DualNeedleGauge({
  completionPct,
  readinessPct,
  evidenceCeiling,
}: {
  completionPct: number;
  readinessPct: number;
  evidenceCeiling?: number | null;
}) {
  const cx = 80;
  const cy = 78;
  const r = 58;
  const ceiling = evidenceCeiling == null ? null : polar(cx, cy, r + 6, Math.max(0, Math.min(100, evidenceCeiling)) * 1.8);

  return (
    <div className="flex flex-col items-center gap-1 min-w-40">
      <svg viewBox="0 0 160 96" className="w-40 h-24" role="img" aria-label={`Completion ${Math.round(completionPct)} percent, readiness ${Math.round(readinessPct)} percent`}>
        <path d="M 22 78 A 58 58 0 0 1 138 78" fill="none" stroke="hsl(var(--border))" strokeWidth="10" strokeLinecap="round" />
        <path d="M 22 78 A 58 58 0 0 1 138 78" fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeDasharray="4 8" opacity="0.35" />
        {ceiling && <circle cx={ceiling.x} cy={ceiling.y} r="3.5" fill="hsl(38 55% 52%)" />}
        {needle(cx, cy, r - 8, completionPct, "hsl(var(--primary))")}
        {needle(cx, cy, r - 16, readinessPct, "hsl(38 55% 52%)")}
        <circle cx={cx} cy={cy} r="4" fill="hsl(var(--foreground))" />
      </svg>
      <div className="flex gap-3 text-[11px] text-muted-foreground">
        <span><span className="inline-block w-2 h-2 rounded-full bg-primary mr-1" />{Math.round(completionPct)}% complete</span>
        <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "hsl(38 55% 52%)" }} />{Math.round(readinessPct)}% ready</span>
      </div>
      {evidenceCeiling != null && (
        <div className="text-[10px] text-muted-foreground">Evidence ceiling {Math.round(evidenceCeiling)}%</div>
      )}
    </div>
  );
}
