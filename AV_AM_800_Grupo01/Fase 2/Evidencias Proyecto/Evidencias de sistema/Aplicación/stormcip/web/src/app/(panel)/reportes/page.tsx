"use client";
import { useCiclosPlanta, useEstadosDecision, useOportunidades } from "@/hooks/usePlanta";
import { Kpi } from "@/components/ui/Kpi";
import { Ic } from "@/components/ui/Ic";
import { gsap, useEntrada } from "@/lib/animacion";
import { fechaDe, nf, periodo, semanas } from "@/lib/planta";

const DIA = 86400000;

function GraficoSemanas({ datos }: { datos: ReturnType<typeof semanas> }) {
  const min = Math.floor(Math.min(...datos.map((d) => d.pct), 80) / 5) * 5;
  const xx = (i: number) => 90 + i * 118;
  const yA = (v: number) => 354 - ((v - min) / (100 - min)) * 320;
  const maxD = Math.max(...datos.map((d) => d.desvios), 4);
  const yB = (v: number) => 354 - (v / maxD) * 130;
  const ref = useEntrada<SVGSVGElement>((r) => {
    gsap.fromTo(r.querySelectorAll(".rep-bar"), { scaleY: 0, transformOrigin: "50% 100%" }, { scaleY: 1, duration: 0.6, stagger: 0.06, ease: "power3.out", delay: 0.4 });
    gsap.fromTo(r.querySelector(".lv-l1"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 1, ease: "power2.inOut", delay: 0.7 });
  }, [datos.length]);
  return (
    <svg ref={ref} viewBox="0 0 640 400" role="img" aria-label="Porcentaje de ciclos validados y ciclos con desvío por semana">
      {[min, (min + 100) / 2, 100].map((v) => (
        <g key={v}><line x1={50} x2={620} y1={yA(v)} y2={yA(v)} className="lv-grid" /><text x={42} y={yA(v) + 4} className="lv-tick" textAnchor="end">{nf(v)}%</text></g>
      ))}
      {datos.map((d, i) => (
        <g key={d.etiqueta}>
          <rect x={xx(i) - 18} y={yB(d.desvios)} width={36} height={354 - yB(d.desvios)} className="rep-bar" />
          <text x={xx(i)} y={348} className="rep-n" textAnchor="middle">{d.desvios}</text>
          <text x={xx(i)} y={380} className="lv-tick" textAnchor="middle">{d.etiqueta}</text>
        </g>
      ))}
      <polyline points={datos.map((d, i) => `${xx(i)},${yA(d.pct)}`).join(" ")} className="lv-l1" fill="none" />
      {datos.map((d, i) => (
        <g key={`p${d.etiqueta}`}>
          <circle cx={xx(i)} cy={yA(d.pct)} r={4.5} className="lv-l1d" />
          <text x={xx(i)} y={yA(d.pct) - 12} className="rep-v" textAnchor="middle">{nf(d.pct, 1)}</text>
        </g>
      ))}
    </svg>
  );
}

export default function ReportesPage() {
  const { ciclos, cargando } = useCiclosPlanta();
  const { oportunidades: o } = useOportunidades();
  const estados = useEstadosDecision();
  const ahora = Date.now();
  const mes = ciclos.filter((c) => c.resumen && (fechaDe(c.inicio)?.getTime() ?? 0) >= ahora - 30 * DIA);
  const validados = mes.filter((c) => c.resumen!.validacion === "validado").length;
  const desvio = mes.filter((c) => c.resumen!.validacion === "desvio").length;
  const fuera = mes.filter((c) => c.resumen!.validacion === "fuera").length;
  const p = periodo(ciclos, ahora - 30 * DIA, ahora + 1);
  const previo = periodo(ciclos, ahora - 60 * DIA, ahora - 30 * DIA);
  const pct = mes.length ? (validados / mes.length) * 100 : 0;
  const foco = o?.decisiones.find((d) => d.tipo === "revisar_circuito") ?? o?.decisiones.find((d) => d.tipo === "posible_fuga");
  const aprobadas = o?.decisiones.filter((d) => estados[d.id]?.estado === "aprobada").length ?? 0;
  const raiz = useEntrada<HTMLElement>((el) => {
    gsap.fromTo(el.children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "power3.out" });
  }, [cargando]);

  return (
    <section className="v v-rep" ref={raiz}>
      <div className="rp__lead card">
        <p className="pcard__t">Resumen para gerencia</p>
        <p className="rp__msg">
          Los últimos 30 días cerraron con <b>{nf(pct, 1)} %</b> de ciclos validados a la primera
          {fuera === 0 ? " y ningún ciclo fuera de límite" : <> y <b className="w">{fuera} fuera de límite</b></>}.
          {foco && <> El foco abierto es <b className="w">{foco.titulo.toLowerCase()}</b>.</>}
          {o && <> Hay <b>{nf(o.totales.aguaMesL / 1000, 1)} m³/mes</b> de agua por ahorrar.</>}
        </p>
      </div>
      <div className="kpis kpis--6">
        <Kpi l="Ciclos CIP" v={mes.length} d="8 circuitos" />
        <Kpi l="1ª validación" v={pct} dec={1} suf=" %" d={`${validados} de ${mes.length}`} />
        <Kpi l="Con desvío" v={desvio} d="corregidos en línea" />
        <Kpi l="Fuera de límite" v={fuera} d="circuito retenido" tono={fuera ? "down" : undefined} />
        <Kpi l="Tiempo de CIP" v={p.horas / 30} dec={1} suf=" h/día" d={previo.horas ? `${nf(previo.horas / 30, 1)} h antes` : ""} />
        <Kpi l="Decisiones" v={aprobadas} suf={` / ${o?.decisiones.length ?? 0}`} d="aprobadas" />
      </div>
      <section className="card pcard rp__chart2">
        <p className="pcard__t">Últimas 5 semanas <span className="lg"><i className="lg-a" />% ciclos validados <i className="lg-bar" />Ciclos con desvío</span></p>
        <GraficoSemanas datos={semanas(ciclos, new Date())} />
      </section>
      <section className="card pcard">
        <p className="pcard__t">Evidencia para auditoría <span className="mono">FSSC 22000</span></p>
        <div className="evi">
          {[["Registros de ciclo CIP", `${mes.length} de ${mes.length}`], ["Curva por ciclo, sin digitación", nf(mes.length)], ["Desvíos con corrección registrada", nf(desvio)], ["Ciclos retenidos", nf(fuera)], ["Decisiones de receta con responsable", nf(aprobadas)]].map(([a, b]) => (
            <div key={a}><span><Ic n="check" />{a}</span><b className="mono">{b}</b></div>
          ))}
        </div>
      </section>
      <section className="card rp__doc2">
        <div className="doc__pg">
          <i className="doc__logo" /><b>Informe de limpieza</b>
          <span>{new Date().toLocaleDateString("es-CL", { month: "long", year: "numeric" })}</span>
          <i className="doc__l w80" /><i className="doc__l w60" /><i className="doc__map" /><i className="doc__l w90" /><i className="doc__l w40" />
        </div>
        <div className="doc__btns"><button className="btn2 btn2--pri" onClick={() => window.print()}><Ic n="download" />Imprimir informe</button></div>
      </section>
    </section>
  );
}
