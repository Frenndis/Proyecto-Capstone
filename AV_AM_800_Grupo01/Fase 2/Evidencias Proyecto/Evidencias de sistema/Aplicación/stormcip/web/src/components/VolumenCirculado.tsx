"use client";
import { EstadoVolumen, FilaUso, formatearLitros, formatearM3, formatearUso } from "@/lib/volumenCirculado";

// Líquido usado en el ciclo, por etapa y por tipo de líquido. El agua (enjuagues
// y desinfección, de paso único) sale del caudal integrado; soda y ácido son la
// solución retenida en el circuito, una estimación del modelo que se marca con
// las tres señales redundantes de IndicadoresCiclo (borde punteado, ámbar y ≈):
// el color solo no sobrevive a una captura en blanco y negro ni al daltonismo.
// Agua de red, agua recuperada y químicos no se suman entre sí. Sin caudal
// informado se dice así: un "0" se leería como una medición.
//
// Las barras son HTML/CSS y no un gráfico de recharts: una etapa que aún no corrió
// no tiene valor y recharts no dibuja ni su barra ni su etiqueta, y ahí tiene que
// verse un "—".
const ESTIMADO = "border border-dashed border-amber-600 text-amber-700 dark:border-amber-400 dark:text-amber-300";

function Fila({ f, maximo }: { f: FilaUso; maximo: number }) {
  const metodo = f.tipo === "quimico"
    ? "solución retenida en el circuito (estimado del modelo)"
    : f.fuente === "recuperada" ? "agua recuperada" : "agua de red";
  return (
    <li className="text-sm" title={`${f.label}: ${formatearUso(f)}`}>
      <div className="grid grid-cols-[minmax(7.5rem,13rem)_1fr_8.5rem] items-center gap-3">
        <span className="text-right">{f.label}</span>
        <span className="h-5">
          {f.litros !== null && (
            <span className={`block h-full rounded-r ${f.estimado
              ? "border border-dashed border-amber-600 bg-amber-600/30"
              : f.monitoreada ? "bg-blue-500" : "bg-amber-600"}`}
              style={{ width: `${Math.max((f.litros / maximo) * 100, 0.5)}%` }} />
          )}
        </span>
        <span className={`tabular-nums ${f.estimado && f.litros !== null ? `rounded px-1 ${ESTIMADO}` : ""}`}>
          {f.estimado && f.litros !== null && <span title="valor estimado, no medido">≈ </span>}
          {f.litros === null && f.enCurso ? "en curso…" : formatearUso(f)}
        </span>
      </div>
      <p className="text-right text-xs text-slate-500">
        {metodo}
        {f.sanitizanteSinDato && " · sanitizante: sin dato"}
        {f.recirculadoL !== null && ` · recirculado ${formatearLitros(f.recirculadoL)} (no es consumo)`}
      </p>
    </li>
  );
}

function Total({ titulo, valor, estimado = false }: { titulo: string; valor: string; estimado?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-1.5 ${estimado ? ESTIMADO : "border border-slate-200 dark:border-slate-700"}`}>
      <div className="text-xs text-slate-500">{titulo}</div>
      <b className="text-base font-semibold tabular-nums">{estimado && valor !== "—" && "≈ "}{valor}</b>
    </div>
  );
}

export default function VolumenCirculado({ estado }: { estado: EstadoVolumen }) {
  const maximo = estado.tipo === "listo"
    ? Math.max(...estado.filas.map((f) => f.litros ?? 0), 1) : 1;

  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-medium">Líquido usado</h2>
        {estado.tipo === "listo" && estado.simulado && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Simulado</span>
        )}
      </div>

      {estado.tipo === "sin_caudal" && (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-600">
          Sin caudal: el equipo no informa caudal en este ciclo, así que no se puede calcular el líquido usado.
        </p>
      )}
      {estado.tipo === "acumulando" && (
        <p className="text-sm text-slate-500">Acumulando volumen…</p>
      )}

      {estado.tipo === "listo" && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Total titulo="Agua de red" valor={formatearM3(estado.totales.aguaRedL)} />
            <Total titulo="Agua recuperada" valor={formatearM3(estado.totales.aguaRecuperadaL)} />
            <Total titulo="Soda (solución)" valor={formatearLitros(estado.totales.sodaL)} estimado />
            <Total titulo="Ácido (solución)" valor={formatearLitros(estado.totales.acidoL)} estimado />
          </div>

          <ul className="space-y-2">
            {estado.filas.map((f) => <Fila key={f.etapa} f={f} maximo={maximo} />)}
          </ul>

          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <p>
              Agua medida por caudal integrado; ~2 % bajo el valor real por los bordes de etapa.
              El total de cada tipo es la suma de sus filas.
              {estado.huecos > 0 && ` ${estado.huecos} corte${estado.huecos === 1 ? "" : "s"} de señal sin contar.`}
            </p>
            <p>
              El enjuague final devuelve parte de su agua al estanque de agua recuperada; aun así se
              cuenta como agua de red usada.
            </p>
            <p>
              Soda y ácido: <b>≈ estimado del modelo</b> (solución retenida en el circuito, constante del modelo y no
              una medición). Es solución diluida de trabajo, no químico concentrado. El volumen que recirculó
              se muestra aparte y no se suma como consumo.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
