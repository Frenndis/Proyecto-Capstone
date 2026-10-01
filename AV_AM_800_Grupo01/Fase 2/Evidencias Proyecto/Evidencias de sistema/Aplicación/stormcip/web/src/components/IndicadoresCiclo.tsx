"use client";
// Indicadores agregados del ciclo, los que calcula el trigger alCerrarCiclo.
//
// Requisito de honestidad del MVP: un indicador "estimado" NO se puede ver igual
// que uno "medido". volumenEstimado sale del caudal nominal de la bomba, no de un
// caudalímetro, y quien mire el dashboard tiene que notarlo sin preguntar. Por eso
// el estimado lleva tres marcas redundantes (borde punteado, color ámbar y el
// prefijo ≈) en vez de una sola: el color por sí solo no se ve en una captura en
// blanco y negro ni con daltonismo.
import {
  Ciclo, Confianza, ETAPAS_MONITOREADAS, ETAPA_LABEL, INDICADORES_CICLO,
  MarcaTiempo, META, estadoIndicadores, formatear,
} from "@/lib/tipos";

function Insignia({ confianza }: { confianza?: Confianza }) {
  const estimado = confianza === "estimado";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${estimado
      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
      {estimado ? "estimado" : "medido"}
    </span>
  );
}

/** Valor con el prefijo ≈ y color ámbar cuando es una estimación. */
function Valor({
  clave, valor, confianza, className = "",
}: {
  clave: string; valor?: number; confianza?: Confianza; className?: string;
}) {
  const estimado = confianza === "estimado";
  if (typeof valor !== "number") return <span className="text-slate-400">—</span>;
  return (
    <span className={`tabular-nums ${className} ${estimado
      ? "text-amber-700 dark:text-amber-300" : ""}`}>
      {estimado && <span title="valor estimado, no medido">≈ </span>}
      {formatear(clave, valor)}
    </span>
  );
}

function fecha(ts?: MarcaTiempo | null) {
  return ts?.toDate ? ts.toDate().toLocaleString("es-CL") : null;
}

export default function IndicadoresCiclo({ ciclo }: { ciclo: Ciclo }) {
  const estado = estadoIndicadores(ciclo);
  const metodo = ciclo.indicadoresMetodo ?? {};
  const confianza = ciclo.indicadoresConfianza ?? {};
  const porEtapa = ciclo.indicadoresPorEtapa ?? {};
  const calculadosEn = fecha(ciclo.indicadoresCalculadosEn);

  // Solo las etapas monitoreadas, y en el orden del proceso (no el de Firestore)
  const etapas = ETAPAS_MONITOREADAS.filter((e) => porEtapa[e]);

  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h2 className="mb-3 font-medium">Indicadores del ciclo</h2>

      {estado.tipo === "pendiente" ? (
        <p className="text-sm text-slate-500">
          Se calculan al cerrar el ciclo, cuando ya existe la curva completa.
        </p>
      ) : estado.tipo === "sin_lecturas" ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm
                      text-slate-500 dark:border-slate-600">
          Ciclo sin lecturas en etapas monitoreadas. Solo se calculan sobre
          preenjuague, enjuague y enjuague final: en las etapas químicas las sondas
          trabajan fuera de su rango.
        </p>
      ) : estado.tipo === "sin_valores" ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm
                      text-slate-500 dark:border-slate-600">
          {estado.lecturas} lectura{estado.lecturas === 1 ? "" : "s"} en etapas
          monitoreadas, pero ninguna con conductividad válida: sin ella no se puede
          calcular ningún indicador.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {estado.claves.map((k) => {
              const estimado = confianza[k] === "estimado";
              return (
                <div key={k} className={`rounded-xl border p-3 ${estimado
                  ? "border-dashed border-amber-400 bg-amber-50 dark:bg-amber-950/20"
                  : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {META[k]?.label ?? k}
                    </p>
                    <Insignia confianza={confianza[k]} />
                  </div>
                  <p className="mt-1 text-2xl font-semibold">
                    <Valor clave={k} valor={ciclo.indicadores?.[k]} confianza={confianza[k]} />
                    <span className="ml-1 text-sm font-normal text-slate-500">
                      {META[k]?.unidad}
                    </span>
                  </p>
                  {/* El método va visible, no en un tooltip: "caudal nominal
                      supuesto" es justo lo que no debe quedar escondido. */}
                  {metodo[k] && (
                    <p className="mt-2 text-[11px] leading-snug text-slate-500">{metodo[k]}</p>
                  )}
                </div>
              );
            })}
          </div>

          {etapas.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-medium">Por etapa</h3>
              {/* overflow-x: la tabla tiene 5 columnas y no cabe en un teléfono */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left dark:border-slate-700">
                      <th className="py-2 pr-3 font-medium">Etapa</th>
                      {INDICADORES_CICLO.map((k) => (
                        <th key={k} className="py-2 pr-3 text-right font-medium">
                          <span className="block text-xs uppercase tracking-wide text-slate-500">
                            {META[k]?.label ?? k}
                          </span>
                          <span className="block text-[10px] font-normal text-slate-400">
                            {META[k]?.unidad || "—"}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {etapas.map((e) => (
                      <tr key={e} className="border-b border-slate-100 last:border-0
                                             dark:border-slate-800">
                        <td className="py-2 pr-3">{ETAPA_LABEL[e] ?? e}</td>
                        {INDICADORES_CICLO.map((k) => (
                          <td key={k} className="py-2 pr-3 text-right">
                            <Valor clave={k} valor={porEtapa[e]?.derivados?.[k]}
                              confianza={porEtapa[e]?.confianza?.[k]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500
                        dark:border-slate-800">
            Calculado sobre {estado.lecturas} lectura
            {estado.lecturas === 1 ? "" : "s"} en etapas monitoreadas
            {calculadosEn && ` · ${calculadosEn}`}.
            {/* La aclaración solo si hay algo estimado: si no, es ruido. */}
            {estado.claves.some((k) => confianza[k] === "estimado") && <>
              {" "}Los valores marcados <b className="font-medium text-amber-700
                dark:text-amber-300">estimado (≈)</b> usan supuestos de
              {" "}<code className="text-[11px]">configuracion/calculos</code>, no mediciones.
            </>}
          </p>
        </>
      )}
    </section>
  );
}
