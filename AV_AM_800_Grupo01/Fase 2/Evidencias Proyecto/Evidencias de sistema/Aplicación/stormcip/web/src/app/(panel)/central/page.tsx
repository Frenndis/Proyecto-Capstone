"use client";
import { useRouter } from "next/navigation";
import { useCiclosHoy } from "@/hooks/usePlanta";
import { useConfigCalculos } from "@/hooks/useCiclos";
import { Kpi } from "@/components/ui/Kpi";
import { gsap, useEntrada } from "@/lib/animacion";
import {
  CicloPlanta, PLANO, estadoCiclo, fechaDe, horaCorta, nf, programadosEn, resumenDia,
} from "@/lib/planta";

const X = 912, Y = 294;

/** Plano de planta: las líneas se dibujan desde la central hasta cada circuito. */
function Plano({ estados, enCurso, onElegir }: { estados: Record<string, string>; enCurso: string[]; onElegir: (id: string) => void }) {
  const ref = useEntrada<SVGSVGElement>((r) => {
    gsap.fromTo(r.querySelector(".c-troncal"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 1.2, ease: "power2.inOut", delay: 0.1 });
    gsap.fromTo(r.querySelectorAll(".c-line--b"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.5, stagger: 0.06, ease: "power2.out", delay: 0.8 });
    gsap.fromTo(r.querySelectorAll(".c-n"), { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.06, delay: 1 });
  }, []);
  // El pulso del circuito en curso sigue vivo aunque el ciclo empiece después de entrar
  const pulso = useEntrada<SVGGElement>((r) => {
    gsap.fromTo(r.querySelectorAll(".c-n__p"), { attr: { r: 12 }, opacity: 0.8 }, { attr: { r: 34 }, opacity: 0, duration: 1.5, repeat: -1, ease: "power2.out" });
  }, [enCurso.join()]);

  return (
    <svg ref={ref} className="plan" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Plano de la planta con los circuitos conectados a la central CIP">
      {PLANO.areas.map(([n, x, y, w, h]) => (
        <g key={n}>
          <rect x={x} y={y} width={w} height={h} className="c-area" />
          <text x={x + 12} y={y + 24} className="room__l">{n}</text>
        </g>
      ))}
      <rect x={846} y={66} width={132} height={92} className="c-cip" />
      <text x={X} y={108} className="c-cip__t" textAnchor="middle">Soda · Ácido</text>
      <text x={X} y={130} className="c-cip__t" textAnchor="middle">Agua</text>
      <path d={`M${X} 158 V${Y} H66`} className="c-line c-troncal" />
      {PLANO.nodos.map((n) => <path key={n.id} d={`M${n.x} ${Y} V${n.y}`} className="c-line c-line--b" />)}
      <g ref={pulso}>
        {PLANO.nodos.filter((n) => enCurso.includes(n.id)).map((n) => <circle key={n.id} cx={n.x} cy={n.y} r={12} className="c-n__p" />)}
      </g>
      {PLANO.nodos.map((n) => (
        <g key={n.id} className="c-n" transform={`translate(${n.x} ${n.y})`} onClick={() => onElegir(n.id)} role="button"
          tabIndex={0} aria-label={`${n.n}: ver ciclo`} onKeyDown={(e) => { if (e.key === "Enter") onElegir(n.id); }}>
          <circle r={11} className={`c-n__c c-n__c--${estados[n.id] ?? "idle"}`} />
          <text y={n.y > Y ? 31 : -19} textAnchor="middle" className="c-n__l">{n.n}</text>
        </g>
      ))}
    </svg>
  );
}

function Fila({ c, onClick }: { c: CicloPlanta; onClick: () => void }) {
  const e = estadoCiclo(c);
  const min = c.resumen ? Math.round(c.resumen.duracionS / 60) : null;
  const litros = c.resumen?.aguaL ?? (c.consumos?.aguaTotal ?? 0) * 1000;
  const tono = e.tono === "live" ? "sc--accent" : `st--${e.tono === "idle" ? "none" : e.tono}`;
  return (
    <div className="frow frow--c2" onClick={onClick} style={{ cursor: "pointer" }}>
      <span className="frow__n">{c.circuito}</span>
      <span className="mono frow__m">{horaCorta(fechaDe(c.inicio))} · {min === null ? "en curso" : `${min} min`} · {nf(litros)} L</span>
      <span className="mono frow__v">{c.resumen?.tempMinSoda != null ? <>{nf(c.resumen.tempMinSoda, 1)}<small> °C</small></> : "—"}</span>
      <span className={`st ${tono}`}><i />{e.texto}</span>
    </div>
  );
}

export default function CentralPage() {
  const router = useRouter();
  const { ciclos, cargando } = useCiclosHoy();
  const cfg = useConfigCalculos() as { metaAguaDiariaM3?: number } | null;
  const r = resumenDia(ciclos);
  const programados = programadosEn(new Date());
  const estados: Record<string, string> = {};
  for (const c of ciclos) estados[c.circuitoId] = estadoCiclo(c).tono;
  const enCurso = ciclos.filter((c) => c.estado === "en_curso").map((c) => c.circuitoId);
  const feed = useEntrada<HTMLDivElement>((el) => {
    gsap.fromTo(el.querySelectorAll(".frow"), { opacity: 0, x: 10 }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.09, ease: "power3.out", delay: 0.2 });
  }, [cargando]);

  const abrir = (id: string) => {
    const hoyDe = ciclos.filter((c) => c.circuitoId === id).pop();
    if (hoyDe?.estado === "en_curso") router.push("/dashboard");
    else if (hoyDe) router.push(`/registros?id=${hoyDe.id}`);
    else router.push(`/dashboard?circuito=${id}`);
  };

  return (
    <section className="v v-central">
      <div className="kpis">
        <Kpi l="Ciclos hoy" v={r.total} d={`de ${programados} programados`} />
        <Kpi l="Validados" v={r.validados} d="TACT cumplido" />
        <Kpi l="Con desvío" v={r.desvios + r.fuera} d={r.fuera ? `${r.fuera} fuera de límite` : "corregido en línea"} tono={r.fuera ? "down" : undefined} />
        <Kpi l="Agua de CIP hoy" v={r.aguaM3} dec={1} suf=" m³" d={`meta ${cfg?.metaAguaDiariaM3 ?? 26} m³`} />
      </div>
      <section className="card map">
        <header className="map__bar">
          <div className="map__title"><b>Circuitos conectados a la central</b><span>Línea de suministro y retorno, por área. Elige un circuito para ver su ciclo.</span></div>
          <span className="lgg">
            <i style={{ background: "#37C08B", borderRadius: "50%" }} />Validado
            <i style={{ background: "#D9A13B", borderRadius: "50%" }} />Con desvío
            <i style={{ background: "#2FB7E8", borderRadius: "50%" }} />En curso
            <i style={{ background: "#5C7896", borderRadius: "50%" }} />Sin ciclo
          </span>
        </header>
        <div className="map__view"><Plano estados={estados} enCurso={enCurso} onElegir={abrir} /></div>
      </section>
      <aside className="card pcard pcard--feed v-side">
        <p className="pcard__t">Limpiezas de hoy <span className="mono">mín. soda</span></p>
        <div className="feed" ref={feed}>
          {cargando ? <p className="pcard__p">Leyendo ciclos…</p>
            : ciclos.length === 0 ? <p className="pcard__p">Aún no hay limpiezas hoy.</p>
            : ciclos.map((c) => <Fila key={c.id} c={c} onClick={() => (c.estado === "en_curso" ? router.push("/dashboard") : router.push(`/registros?id=${c.id}`))} />)}
        </div>
      </aside>
    </section>
  );
}
