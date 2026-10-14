"use client";
import {
  META, Rango, SIN_UMBRAL, esDerivado, fueraDeRango, formatear, textoUmbralAlerta,
} from "@/lib/tipos";
import { ETIQUETA_SIN_COMPENSAR, EstadoTarjeta } from "@/lib/tarjetas";

// Tarjeta de una variable del equipo. El estado ya viene resuelto (estadoTarjeta):
// aquí solo se decide cómo se ve cada uno.
export default function TarjetaSonda({
  variable, estado, rango,
}: {
  variable: string; estado: EstadoTarjeta; rango?: Rango;
}) {
  const meta = META[variable];
  const calculado = esDerivado(variable);

  // Un valor saturado es cota inferior: solo puede violar un máximo, nunca un
  // mínimo (misma regla que alertasDeLectura en el backend). Sin compensar, el
  // umbral es de conductividad25C y no aplica al valor crudo.
  const alerta =
    estado.tipo === "normal" ? fueraDeRango(estado.valor, rango)
    : estado.tipo === "saturado" ? fueraDeRango(estado.valor, { max: rango?.max })
    : false;

  // Es el umbral de alerta de la etapa, no un objetivo ni el criterio de limpieza
  const umbral = textoUmbralAlerta(rango);
  const objetivo = umbral !== SIN_UMBRAL ? umbral : calculado ? "Valor calculado" : SIN_UMBRAL;

  const insignia =
    estado.tipo === "sin_compensar" ? "sin compensar"
    : estado.tipo === "saturado" ? (calculado ? "cota inferior" : "saturado")
    : calculado ? "calculado" : null;

  const unidad = <span className="ml-1 text-sm font-normal text-slate-500">{meta?.unidad}</span>;

  return (
    <div className={`rounded-xl border p-4 ${alerta
      ? "border-red-400 bg-red-50 dark:bg-red-950/30"
      : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
    } ${estado.tipo === "fuera_operacion" ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-slate-500">{meta?.label ?? variable}</p>
        {insignia && (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px]
                           text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {insignia}
          </span>
        )}
      </div>

      {estado.tipo === "sin_dato" ? (
        <p className="mt-2 text-sm text-slate-500">Sin dato: {estado.motivo}</p>
      ) : (
        <>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${alerta ? "text-red-600" : ""}`}>
            {(estado.tipo === "saturado" || (estado.tipo === "sin_compensar" && estado.tope !== undefined)) && "≥ "}
            {formatear(variable,
              estado.tipo === "saturado" ? estado.tope
              : estado.tipo === "sin_compensar" ? estado.tope ?? estado.valor
              : estado.valor)}
            {unidad}
          </p>
          <p className={`mt-1 text-xs ${alerta ? "text-red-600" : "text-slate-500"}`}>
            {alerta ? "Fuera de rango"
              : estado.tipo === "fuera_operacion" ? "Fuera de operación: dato no confiable"
              : estado.tipo === "saturado" ? (calculado ? "Sonda saturada: valor real mayor o igual" : "Sonda saturada: valor real mayor")
              : estado.tipo === "sin_compensar"
                ? `${ETIQUETA_SIN_COMPENSAR}${estado.causa ? ` · ${estado.causa}` : ""}`
                : objetivo}
          </p>
        </>
      )}
    </div>
  );
}
