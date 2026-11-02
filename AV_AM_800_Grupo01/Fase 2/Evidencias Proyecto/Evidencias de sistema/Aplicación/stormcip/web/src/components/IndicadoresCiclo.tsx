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
    <span className={`shrink-0 rounded-ctrl px-2 py-0.5 text-[10px] ${estimado
      ? "bg-warn/10 text-warn"
      : "bg-raise text-ink-2"}`}>
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
  if (typeof valor !== "number") return <span className="text-ink-3">—</span>;
  return (
    <span className={`font-mono tabular-nums ${className} ${estimado
      ? "text-warn" : ""}`}>
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

  // "Tiempo hasta limpio" se muestra siempre: si falta, es justamente el dato
  // importante (el enjuague final no quedó limpio) y no puede desaparecer.
  const claves = estado.tipo === "listo" && !estado.claves.includes("tiempoHastaLimpio")
    ? ["tiempoHastaLimpio", ...estado.claves] : estado.tipo === "listo" ? estado.claves : [];
  const sinLimpio = porEtapa.enjuague_final
    ? "El enjuague final no alcanzó el criterio de limpieza."
    : "Sin lecturas del enjuague final: no se puede evaluar.";

  return (
    <section className="sc-card p-4">
      <h2 className="sc-eyebrow mb-3">Indicadores del ciclo</h2>

      {estado.tipo === "pendiente" ? (
        <p className="text-sm text-ink-3">
          Se calculan al cerrar el ciclo, cuando ya existe la curva completa.
        </p>
      ) : estado.tipo === "sin_lecturas" ? (
        <p className="rounded-ctrl border border-dashed border-line p-3 text-sm
                      text-ink-3">
          Ciclo sin lecturas en etapas monitoreadas. Solo se calculan sobre
          preenjuague, enjuague y enjuague final: en las etapas químicas las sondas
          trabajan fuera de su rango.
        </p>
      ) : estado.tipo === "sin_valores" ? (
        <p className="rounded-ctrl border border-dashed border-line p-3 text-sm
                      text-ink-3">
          {estado.lecturas} lectura{estado.lecturas === 1 ? "" : "s"} en etapas
          monitoreadas, pero ninguna con conductividad válida: sin ella no se puede
          calcular ningún indicador.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {claves.map((k) => {
              const estimado = confianza[k] === "estimado";
              return (
                <div key={k} className={`rounded-card border p-3 ${estimado
                  ? "border-dashed border-warn bg-warn/10"
                  : "border-line bg-surface"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-ink-3">
                      {META[k]?.label ?? k}
                    </p>
                    <Insignia confianza={confianza[k]} />
                  </div>
                  <p className="mt-1 sc-kpi">
                    <Valor clave={k} valor={ciclo.indicadores?.[k]} confianza={confianza[k]} />
                    <span className="ml-1 text-sm font-normal text-ink-3">
                      {META[k]?.unidad}
                    </span>
                  </p>
                  {/* El método va visible, no en un tooltip: "caudal nominal
                      supuesto" es justo lo que no debe quedar escondido. */}
                  {metodo[k] && (
                    <p className="mt-2 text-[11px] leading-snug text-ink-3">{metodo[k]}</p>
                  )}
                  {k === "tiempoHastaLimpio" && typeof ciclo.indicadores?.[k] !== "number" && (
                    <p className="mt-2 text-[11px] leading-snug text-warn">
                      {sinLimpio}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {etapas.length > 0 && (
            <div className="mt-5">
              <h3 className="sc-eyebrow mb-2">Por etapa</h3>
              {/* overflow-x: la tabla tiene 5 columnas y no cabe en un teléfono */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="py-2 pr-3 font-medium">Etapa</th>
                      {INDICADORES_CICLO.map((k) => (
                        <th key={k} className="py-2 pr-3 text-right font-medium">
                          <span className="block text-xs uppercase tracking-wide text-ink-3">
                            {META[k]?.label ?? k}
                          </span>
                          <span className="block text-[10px] font-normal text-ink-3">
                            {META[k]?.unidad || "—"}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {etapas.map((e) => (
                      <tr key={e} className="border-b border-line last:border-0">
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

          <p className="mt-4 border-t border-line pt-3 text-xs text-ink-3">
            Calculado sobre {estado.lecturas} lectura
            {estado.lecturas === 1 ? "" : "s"} en etapas monitoreadas
            {calculadosEn && ` · ${calculadosEn}`}.
            {/* La aclaración solo si hay algo estimado: si no, es ruido. */}
            {estado.claves.some((k) => confianza[k] === "estimado") && <>
              {" "}Los valores marcados <b className="font-medium text-warn">estimado (≈)</b> usan supuestos de
              {" "}<code className="text-[11px]">configuracion/calculos</code>, no mediciones.
            </>}
          </p>
        </>
      )}
    </section>
  );
}
