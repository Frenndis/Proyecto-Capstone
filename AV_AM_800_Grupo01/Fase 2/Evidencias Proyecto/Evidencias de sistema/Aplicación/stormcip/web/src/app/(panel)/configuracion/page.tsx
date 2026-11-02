"use client";
// Recetas de cada circuito (de la historia de ciclos) y sus límites.
import { useCiclosPlanta } from "@/hooks/usePlanta";
import { useConfigCalculos } from "@/hooks/useCiclos";
import { gsap, useEntrada } from "@/lib/animacion";
import { CicloPlanta, mmss, nf } from "@/lib/planta";

function Receta({ c }: { c: CicloPlanta }) {
  const total = c.fases.reduce((a, f) => a + f.sReceta, 0);
  return (
    <article className="card pcard">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div><b style={{ fontSize: 14 }}>{c.circuito}</b><p className="pcard__p" style={{ color: "var(--ink-3)" }}>{c.programa} · {c.lead}</p></div>
        <b className="mono" style={{ fontSize: 18, whiteSpace: "nowrap" }}>{Math.round(total / 60)} min</b>
      </div>
      <div className="fases-r" style={{ display: "flex", gap: 3, marginTop: 12 }}>
        {c.fases.map((f) => (
          <div key={f.n} style={{ flex: f.sReceta, minWidth: 0, fontSize: 11.5 }}>
            <i style={{ display: "block", height: 8, marginBottom: 6, background: f.c > 0.1 ? "#3E8FC7" : "#2A415E" }} />
            <b style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 600 }} title={f.n}>{f.n}</b>
            <span className="mono" style={{ color: "var(--ink-3)", display: "block", whiteSpace: "nowrap", overflow: "hidden" }}>{mmss(f.sReceta)}</span>
            <span className="mono" style={{ color: "var(--ink-3)", display: "block", whiteSpace: "nowrap", overflow: "hidden" }}>{f.t} °C{f.c > 0.1 ? ` · ${nf(f.c, 1)} %` : ""}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function ConfiguracionPage() {
  const { ciclos, cargando } = useCiclosPlanta(120);
  const cfg = useConfigCalculos();
  const recetas = [...new Map([...ciclos].reverse().map((c) => [c.circuitoId, c])).values()];
  const raiz = useEntrada<HTMLDivElement>((el) => {
    gsap.fromTo(el.querySelectorAll(".fases-r i"), { scaleX: 0, transformOrigin: "0 50%" }, { scaleX: 1, duration: 0.7, stagger: 0.012, ease: "power3.out" });
  }, [recetas.length]);
  return (
    <section className="v" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 14, alignItems: "start" }}>
      <div ref={raiz} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 14 }}>
        {cargando ? <p className="pcard__p">Leyendo recetas…</p> : recetas.map((c) => <Receta key={c.circuitoId} c={c} />)}
      </div>
      <aside className="card pcard">
        <p className="pcard__t">Límites de validación</p>
        <div className="evi">
          <div><span>Agua limpia</span><b className="mono">≤ {cfg?.criterioLimpio?.conductividad25C ?? 200} µS/cm</b></div>
          <div><span>Agua de red</span><b className="mono">{cfg?.conductividadAguaRed ?? 150} µS/cm</b></div>
          <div><span>Velocidad mínima</span><b className="mono">1,5 m/s</b></div>
          <div><span>Meta de agua diaria</span><b className="mono">{(cfg as { metaAguaDiariaM3?: number } | null)?.metaAguaDiariaM3 ?? 26} m³</b></div>
        </div>
        <p className="pcard__p" style={{ marginTop: 12, color: "var(--ink-3)" }}>Recetas y límites de ejemplo. En cada planta se cargan los validados de cada circuito.</p>
      </aside>
    </section>
  );
}
