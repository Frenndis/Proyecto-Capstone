"use client";
import Link from "next/link";
import { useCiclosPlanta, useOportunidades } from "@/hooks/usePlanta";
import { useConfigCalculos } from "@/hooks/useCiclos";
import { Kpi } from "@/components/ui/Kpi";
import { Ic } from "@/components/ui/Ic";
import { gsap, useEntrada } from "@/lib/animacion";
import { aguaPorCircuito, aguaPorDia, nf, periodo, variacion } from "@/lib/planta";

const DIA = 86400000;

function GraficoDia({ datos, meta }: { datos: { dia: Date; m3: number }[]; meta: number }) {
  const max = Math.max(meta * 1.25, ...datos.map((d) => d.m3), 1);
  const xx = (i: number) => 40 + (i / (datos.length - 1)) * 700;
  const yy = (m: number) => 462 - (m / max) * 440;
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((p) => Math.round(max * p));
  const ref = useEntrada<SVGSVGElement>((r) => {
    gsap.fromTo(r.querySelector(".lv-l1"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 1.4, ease: "power2.inOut", delay: 0.2 });
  }, [datos.length]);
  return (
    <svg ref={ref} viewBox="0 0 760 500" role="img" aria-label="Agua de CIP por día, últimos 30 días">
      {marcas.map((m) => (
        <g key={m}><line x1={40} x2={740} y1={yy(m)} y2={yy(m)} className="lv-grid" /><text x={32} y={yy(m) + 4} className="lv-tick" textAnchor="end">{m}</text></g>
      ))}
      <line x1={40} x2={740} y1={yy(meta)} y2={yy(meta)} className="cons-m" />
      <polyline points={datos.map((d, i) => `${xx(i).toFixed(1)},${yy(d.m3).toFixed(1)}`).join(" ")} className="lv-l1" fill="none" />
      {[0, 10, 20, 29].map((i) => datos[i] && (
        <text key={i} x={xx(i)} y={488} className="lv-tick" textAnchor="middle">{datos[i].dia.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })}</text>
      ))}
    </svg>
  );
}

export default function ConsumosPage() {
  const { ciclos, cargando } = useCiclosPlanta();
  const { oportunidades } = useOportunidades();
  const cfg = useConfigCalculos() as { metaAguaDiariaM3?: number } | null;
  const ahora = Date.now();
  const act = periodo(ciclos, ahora - 30 * DIA, ahora + 1);
  const pre = periodo(ciclos, ahora - 60 * DIA, ahora - 30 * DIA);
  const vAgua = variacion(act.aguaL, pre.aguaL), vQuim = variacion(act.quimicoL, pre.quimicoL), vHoras = variacion(act.horas, pre.horas);
  const rank = aguaPorCircuito(ciclos, ahora - 30 * DIA);
  const maxRank = rank[0]?.m3 ?? 1;
  const barras = useEntrada<HTMLDivElement>((el) => {
    gsap.fromTo(el.querySelectorAll(".rk__b i"), { scaleX: 0, transformOrigin: "0 50%" }, { scaleX: 1, duration: 0.6, stagger: 0.06, ease: "power3.out", delay: 0.4 });
  }, [rank.length]);
  const fugas = oportunidades?.decisiones.filter((d) => d.tipo === "posible_fuga") ?? [];
  const t = oportunidades?.totales;

  return (
    <section className="v v-cons">
      <div className="kpis">
        <Kpi l="Agua de CIP · 30 días" v={act.aguaL / 1000} suf=" m³" d={vAgua.texto} tono={vAgua.baja ? "up" : "down"} />
        <Kpi l="Químico · 30 días" v={act.quimicoL} suf=" L" d={vQuim.texto} tono={vQuim.baja ? "up" : "down"} />
        <Kpi l="Tiempo de CIP" v={act.horas / 30} dec={1} suf=" h/día" d={vHoras.texto} tono={vHoras.baja ? "up" : "down"} />
        <Kpi l="Agua por ciclo" v={act.ciclos ? act.aguaL / act.ciclos : 0} suf=" L" d={`${act.ciclos} ciclos`} />
      </div>
      <section className="card pcard cons-c">
        <p className="pcard__t">Agua de CIP por día <span className="lg"><i className="lg-a" />Real <i className="lg-m" />Meta {cfg?.metaAguaDiariaM3 ?? 26} m³</span></p>
        {cargando ? <p className="pcard__p">Leyendo ciclos…</p> : <GraficoDia datos={aguaPorDia(ciclos, new Date())} meta={cfg?.metaAguaDiariaM3 ?? 26} />}
      </section>
      <section className="card pcard cons-r">
        <p className="pcard__t">Agua por circuito · 30 días <span className="mono">m³</span></p>
        <div className="rank" ref={barras}>
          {rank.map((r) => (
            <div className="rk rk--b" key={r.n}>
              <span className="rk__n" title={r.n}>{r.n}</span>
              <span className="rk__b"><i style={{ width: `${(r.m3 / maxRank) * 100}%` }} /></span>
              <b className="mono">{nf(r.m3)}</b>
            </div>
          ))}
        </div>
      </section>
      <aside className="cons-s">
        {fugas.map((d) => (
          <section className="card pcard anom" key={d.id}>
            <p className="pcard__t"><Ic n="alert" /> Posible fuga</p>
            <b>{d.circuito}</b>
            <p className="pcard__p">{d.hoy}. {d.porque}</p>
          </section>
        ))}
        {t && (
          <section className="card pcard case">
            <p className="pcard__t">Ahorro detectado por Storm CIP</p>
            <div className="case__big"><b className="mono">{nf(t.aguaMesL / 1000, 1)} m³/mes</b><span>de agua, sin bajar la limpieza</span></div>
            <dl className="case__dl">
              <div><dt>Sobre el consumo actual</dt><dd className="mono">{nf((t.aguaMesL / Math.max(t.aguaActualMesL, 1)) * 100)} %</dd></div>
              <div><dt>Químico</dt><dd className="mono">{nf(t.quimicoMesL)} L/mes</dd></div>
              <div><dt>Tiempo de planta</dt><dd className="mono">{nf(t.minutosMes / 60, 1)} h/mes</dd></div>
            </dl>
            <Link href="/prediccion" className="btn2 btn2--pri" style={{ width: "100%" }}>Ver qué decidir <Ic n="arrow" /></Link>
          </section>
        )}
      </aside>
    </section>
  );
}
