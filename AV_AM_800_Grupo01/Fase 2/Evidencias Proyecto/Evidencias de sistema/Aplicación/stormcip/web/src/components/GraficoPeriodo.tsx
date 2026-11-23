"use client";
// Gráfico del ciclo en vivo con variables y periodo a elección. Cada variable va en su
// propio carril (unidades distintas no comparten eje). Con un periodo mayor que el ciclo
// actual dibuja las lecturas de TODOS los ciclos del periodo, uno tras otro.
import { useMemo, useRef, useState } from "react";
import { useCiclosPeriodo } from "@/hooks/usePlanta";
import { CicloPlanta, PuntoCurva, faseEn, fechaDe, inicioFase, mmss, nf } from "@/lib/planta";
import { Segmento, VARIABLES, VARIABLES_DEFECTO, VarId, rangoFase, segmentosPeriodo } from "@/lib/tendencia";

type Periodo = "ciclo" | "hoy" | "7d" | "30d" | "rango";
const PERIODOS: [Periodo, string][] = [["ciclo", "Este ciclo"], ["hoy", "Hoy"], ["7d", "Últimos 7 días"], ["30d", "Últimos 30 días"], ["rango", "Entre fechas"]];
const DIA = 86400000;
const X0 = 50, X1 = 712, ALTO = 132, SEP = 30, ARRIBA = 20;
const CLAVE = "stormcip.grafico";

type Preferencia = { vars: VarId[]; periodo: Periodo; todos: boolean };
function leerPreferencia(): Preferencia {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as Partial<Preferencia> | null;
    const vars = (p?.vars ?? []).filter((v) => VARIABLES.some((x) => x.id === v));
    return {
      vars: vars.length ? vars : VARIABLES_DEFECTO,
      periodo: p?.periodo && p.periodo !== "rango" && PERIODOS.some(([id]) => id === p.periodo) ? p.periodo : "ciclo",
      todos: p?.todos === true,
    };
  } catch { return { vars: VARIABLES_DEFECTO, periodo: "ciclo", todos: false }; }
}
const fechaInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const deInput = (s: string) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, (m ?? 1) - 1, d ?? 1).getTime(); };

/** Tope del eje: un número redondo sobre el máximo. */
function techo(max: number) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 1.5, 2, 3, 4, 5, 6, 8, 10].map((k) => k * p).find((k) => k >= max * 1.04) ?? 10 * p;
}
const fueraDeRango = (c: CicloPlanta, p: PuntoCurva, v: VarId) => {
  const i = faseEn(c.fases, p.t), f = c.fases[i], r = rangoFase(f, v);
  if (!r || p.t - inicioFase(c.fases, i) < Math.min(150, f.s * 0.4)) return false;
  return (r.min !== undefined && p[v] < r.min) || (r.max !== undefined && p[v] > r.max);
};

type Cursor = { seg: Segmento; p: PuntoCurva; x: number; izq: number };

export default function GraficoPeriodo({ ciclo }: { ciclo: CicloPlanta }) {
  const [pref, setPref] = useState<Preferencia>(leerPreferencia);
  const [rango, setRango] = useState(() => { const h = new Date(); return { desde: fechaInput(new Date(h.getTime() - 2 * DIA)), hasta: fechaInput(h) }; });
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const guardar = (p: Preferencia) => { setPref(p); setCursor(null); try { localStorage.setItem(CLAVE, JSON.stringify(p)); } catch { /* sin almacenamiento */ } };
  const { vars, periodo, todos } = pref;

  // Los límites se fijan al elegir el periodo: recalcular "ahora" en cada render reabriría la consulta
  const limites = useMemo(() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    if (periodo === "ciclo") return { desde: null, hasta: null };
    if (periodo === "hoy") return { desde: hoy.getTime(), hasta: null };
    if (periodo === "7d") return { desde: hoy.getTime() - 6 * DIA, hasta: null };
    if (periodo === "30d") return { desde: hoy.getTime() - 29 * DIA, hasta: null };
    const a = deInput(rango.desde), b = deInput(rango.hasta);
    return Number.isFinite(a) && Number.isFinite(b) && a <= b ? { desde: a, hasta: b + DIA - 1 } : { desde: null, hasta: null };
  }, [periodo, rango.desde, rango.hasta]);
  const consulta = useCiclosPeriodo(limites.desde, limites.hasta);

  const ciclos = useMemo(
    () => (periodo === "ciclo" ? [ciclo] : consulta.ciclos.filter((c) => c.estado !== "abortado" && (todos || c.circuitoId === ciclo.circuitoId))),
    [periodo, ciclo, consulta.ciclos, todos],
  );
  const { segmentos, total } = useMemo(() => segmentosPeriodo(ciclos), [ciclos]);
  const lecturas = ciclos.reduce((a, c) => a + (c.curva?.length ?? 0), 0);
  const uno = segmentos.length === 1;
  const xDe = (x: number) => X0 + (x / total) * (X1 - X0);

  const carriles = useMemo(() => VARIABLES.filter((v) => vars.includes(v.id)).map((v, k) => {
    let max = 0;
    for (const s of segmentos) {
      for (const p of s.puntos) if (p[v.id] > max) max = p[v.id];
      for (const f of s.ciclo.fases) { const r = rangoFase(f, v.id); max = Math.max(max, r?.max ?? r?.min ?? 0); }
    }
    const tope = techo(max), y0 = ARRIBA + k * (ALTO + SEP), y1 = y0 + ALTO;
    return { v, tope, y0, y1, y: (val: number) => y1 - (Math.min(val, tope) / tope) * ALTO };
  }), [vars, segmentos]);
  const altoTotal = ARRIBA + carriles.length * (ALTO + SEP) + 6;

  const trazos = useMemo(() => carriles.map((c) => segmentos.map((s) => ({
    linea: s.puntos.map((p) => `${xDe(s.x0 + p.t).toFixed(1)},${c.y(p[c.v.id]).toFixed(1)}`).join(" "),
    fuera: s.puntos.filter((p) => fueraDeRango(s.ciclo, p, c.v.id)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }))), [carriles, segmentos, total]);

  const mover = (e: React.MouseEvent<SVGSVGElement>) => {
    const caja = svg.current?.getBoundingClientRect();
    if (!caja || !segmentos.length) return;
    const pos = (((e.clientX - caja.left) / caja.width) * 720 - X0) / (X1 - X0) * total;
    // El ciclo bajo el cursor; entre dos ciclos, el más cercano
    const distancia = (s: Segmento) => (pos < s.x0 ? s.x0 - pos : pos > s.x1 ? pos - s.x1 : 0);
    const seg = segmentos.reduce((m, s) => (distancia(s) < distancia(m) ? s : m), segmentos[0]);
    const t = Math.max(0, Math.min(pos - seg.x0, seg.x1 - seg.x0));
    const p = seg.puntos.reduce((m, q) => (Math.abs(q.t - t) < Math.abs(m.t - t) ? q : m), seg.puntos[0]);
    const x = xDe(seg.x0 + p.t);
    setCursor({ seg, p, x, izq: (x / 720) * 100 });
  };

  // Etiquetas del eje: en un ciclo, el tiempo; en un periodo, cuándo empezó cada ciclo
  const marcas = useMemo(() => {
    if (!segmentos.length) return [];
    if (uno) {
      const dur = segmentos[0].x1, paso = [30, 60, 120, 300, 600, 900, 1800].find((s) => dur / s <= 8) ?? 3600;
      return Array.from({ length: Math.floor(dur / paso) + 1 }, (_, i) => ({ x: xDe(i * paso), t: mmss(i * paso) }));
    }
    const conHora = segmentos.length <= 8;
    const out: { x: number; t: string }[] = [];
    let ultimoDia = "";
    for (const s of segmentos) {
      const d = fechaDe(s.ciclo.inicio);
      if (!d) continue;
      const dia = d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" });
      const x = xDe(s.x0);
      if (!conHora && dia === ultimoDia) continue;
      if (out.length && x - out[out.length - 1].x < (conHora ? 78 : 44)) continue;
      ultimoDia = dia;
      out.push({ x, t: conHora ? `${dia} ${d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false })}` : dia });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentos, total, uno]);

  const alternar = (id: VarId) => {
    const nuevas = vars.includes(id) ? vars.filter((v) => v !== id) : [...vars, id];
    if (nuevas.length) guardar({ ...pref, vars: VARIABLES.map((v) => v.id).filter((v) => nuevas.includes(v)) });
  };
  const enVivo = uno && ciclo.estado === "en_curso" && periodo === "ciclo";
  const faseCursor = cursor ? cursor.seg.ciclo.fases[faseEn(cursor.seg.ciclo.fases, cursor.p.t)] : null;
  const decTick = (n: number, tope: number) => (Number.isInteger(n) ? 0 : tope < 2 ? 2 : 1);

  return (
    <div className="gp">
      <div className="gp__ctrl">
        <div className="gp__vars" role="group" aria-label="Variables del gráfico">
          {VARIABLES.map((v) => (
            <button key={v.id} type="button" className={`chip${vars.includes(v.id) ? " is-on" : ""}`} aria-pressed={vars.includes(v.id)} onClick={() => alternar(v.id)}>{v.corto}</button>
          ))}
        </div>
        <label>Periodo
          <select value={periodo} onChange={(e) => guardar({ ...pref, periodo: e.target.value as Periodo })}>
            {PERIODOS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </label>
        {periodo === "rango" && (
          <>
            <label>Desde <input type="date" value={rango.desde} max={rango.hasta} onChange={(e) => setRango({ ...rango, desde: e.target.value })} /></label>
            <label>Hasta <input type="date" value={rango.hasta} min={rango.desde} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} /></label>
          </>
        )}
        {periodo !== "ciclo" && (
          <label>Circuito
            <select value={todos ? "todos" : "este"} onChange={(e) => guardar({ ...pref, todos: e.target.value === "todos" })}>
              <option value="este">{ciclo.circuito}</option>
              <option value="todos">Todos los circuitos</option>
            </select>
          </label>
        )}
        <span className="gp__n mono">
          {consulta.cargando ? "Leyendo…" : `${nf(segmentos.length)} ${uno ? "ciclo" : "ciclos"} · ${nf(lecturas)} lecturas`}
        </span>
      </div>

      {consulta.error ? <p className="gp__vacio">{consulta.error}</p>
        : !segmentos.length ? <p className="gp__vacio">{consulta.cargando ? "Leyendo los ciclos del periodo…" : "No hay ciclos en este periodo. Prueba con otro periodo o con «Todos los circuitos»."}</p>
        : (
          <div className="gp__lienzo">
            <svg ref={svg} viewBox={`0 0 720 ${altoTotal}`} style={{ aspectRatio: `720 / ${altoTotal}` }} role="img"
              aria-label={`${carriles.map((c) => c.v.nombre).join(", ")} de ${segmentos.length} ${uno ? "ciclo" : "ciclos"}`}
              onMouseMove={mover} onMouseLeave={() => setCursor(null)}>
              {carriles.map((c, k) => (
                <g key={c.v.id}>
                  {[0, 0.5, 1].map((fr) => (
                    <g key={fr}>
                      <line x1={X0} x2={X1} y1={c.y(c.tope * fr)} y2={c.y(c.tope * fr)} className="lv-grid" />
                      <text x={X0 - 8} y={c.y(c.tope * fr) + 4} className="lv-tick" textAnchor="end">{nf(c.tope * fr, decTick(c.tope * fr, c.tope))}</text>
                    </g>
                  ))}
                  <text x={X0} y={c.y0 - 7} className="lv-lane">{c.v.nombre}, {c.v.unidad}</text>
                  {segmentos.length <= 24 && segmentos.map((s) => s.ciclo.fases.map((f, i) => {
                    const r = rangoFase(f, c.v.id);
                    if (!r) return null;
                    const a = xDe(s.x0 + inicioFase(s.ciclo.fases, i)), b = xDe(s.x0 + inicioFase(s.ciclo.fases, i + 1));
                    const arriba = c.y(r.max ?? c.tope), abajo = c.y(r.min ?? 0);
                    return <rect key={`${s.ciclo.id}${f.n}`} x={a} width={Math.max(0.5, b - a)} y={arriba} height={Math.max(1, abajo - arriba)} className="lv-band" />;
                  }))}
                  {uno && segmentos[0].ciclo.fases.slice(1).map((f, i) => {
                    const x = xDe(inicioFase(segmentos[0].ciclo.fases, i + 1));
                    return <line key={f.n} x1={x} x2={x} y1={c.y0} y2={c.y1} className="lv-div" />;
                  })}
                  {!uno && segmentos.length <= 60 && segmentos.slice(1).map((s, i) => {
                    const x = (xDe(s.x0) + xDe(segmentos[i].x1)) / 2;
                    return <line key={s.ciclo.id} x1={x} x2={x} y1={c.y0} y2={c.y1} className="lv-div" />;
                  })}
                  {trazos[k]?.map((t, i) => <polyline key={segmentos[i].ciclo.id} points={t.linea} className="gp-l" fill="none" />)}
                  {trazos[k]?.map((t, i) => t.fuera.map((p) => (
                    <circle key={`${segmentos[i].ciclo.id}${p.t}`} cx={xDe(segmentos[i].x0 + p.t)} cy={c.y(p[c.v.id])} r={2.6} className="gp-f" />
                  )))}
                  {enVivo && <circle cx={xDe(ciclo.curva[ciclo.curva.length - 1].t)} cy={c.y(ciclo.curva[ciclo.curva.length - 1][c.v.id])} r={4} className="gp-cab" />}
                  {cursor && <circle cx={cursor.x} cy={c.y(cursor.p[c.v.id])} r={4} className="gp-cur" />}
                  {k === carriles.length - 1 && marcas.map((m) => <text key={m.x} x={m.x} y={c.y1 + 16} className="lv-tick" textAnchor={m.x > 680 ? "end" : "start"}>{m.t}</text>)}
                </g>
              ))}
              {cursor && <line x1={cursor.x} x2={cursor.x} y1={ARRIBA} y2={altoTotal - SEP - 6} className="gp-x" />}
            </svg>
            {cursor && faseCursor && (
              <div className="gp__tip" style={cursor.izq > 60 ? { right: `${100 - cursor.izq + 1.5}%` } : { left: `${cursor.izq + 1.5}%` }}>
                <b>{cursor.seg.ciclo.numero} · {cursor.seg.ciclo.circuito}</b>
                <span className="mono">{fechaDe(cursor.seg.ciclo.inicio)?.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} · {faseCursor.n} · {mmss(cursor.p.t)}</span>
                {carriles.map((c) => {
                  const mal = fueraDeRango(cursor.seg.ciclo, cursor.p, c.v.id);
                  return (
                    <span key={c.v.id} className="gp__fila">
                      <i className={mal ? "is-fuera" : ""} />{c.v.corto}
                      <em className="mono">{nf(cursor.p[c.v.id], c.v.dec)} {c.v.unidad}{mal ? " · fuera de rango" : ""}</em>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      <p className="gp__ley">
        <i className="gp__b" />Franja verde: rango válido de la fase
        <i className="gp__p" />Lectura fuera de rango
        {!uno && segmentos.length > 0 && <span>· El eje pone los ciclos uno tras otro; el tiempo entre ciclos no se dibuja{consulta.recortado ? ". Se muestran los 400 ciclos más recientes" : ""}.</span>}
      </p>
    </div>
  );
}
