"use client";
import { useConteo } from "@/lib/animacion";
import { nf } from "@/lib/planta";

export function Kpi({ l, v, dec = 0, suf, d, tono }: { l: string; v: number; dec?: number; suf?: string; d?: string; tono?: "up" | "down" }) {
  const ref = useConteo(v, (n) => nf(n, dec));
  return (
    <div className="kpi">
      <p className="kpi__l">{l}</p>
      <p className="kpi__v mono"><b ref={ref}>0</b>{suf}</p>
      <p className={`kpi__d mono ${tono ?? ""}`}>{d}</p>
    </div>
  );
}
