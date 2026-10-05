"use client";
import { Alerta, ETAPA_LABEL, META, formatear } from "@/lib/tipos";

// Solo lectura: a diferencia de PanelAlertas, acá no se reconoce nada.
// Muestra el cicloId porque, al no estar acotado a un ciclo, hace falta
// para saber de qué lavado vino cada fila.
export default function HistorialAlertas({ alertas }: { alertas: Alerta[] }) {
  if (!alertas.length)
    return <p className="text-sm text-slate-500">Sin alertas registradas.</p>;

  return (
    <ul className="space-y-2">
      {alertas.map((a) => (
        <li key={a.id} className={`flex items-center justify-between gap-3 rounded-lg
                                    border p-3 text-sm ${a.reconocida
            ? "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40"
            : "border-amber-300 bg-amber-50 dark:bg-amber-950/30"}`}>
          <div>
            <p className="font-medium">
              {META[a.variable]?.label ?? a.variable}:{" "}
              {formatear(a.variable, a.ultimoValor)} {META[a.variable]?.unidad}
              {typeof a.conteo === "number" && a.conteo > 1 && (
                <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px]
                                 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  ×{a.conteo}
                </span>
              )}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {a.cicloId} · {ETAPA_LABEL[a.etapa] ?? a.etapa} · límite {a.min ?? "—"}–{a.max ?? "—"} ·
              {" desde "}
              {a.desde?.toDate ? a.desde.toDate().toLocaleTimeString("es-CL") : "—"}
              {a.hasta?.toDate && ` · última ${a.hasta.toDate().toLocaleTimeString("es-CL")}`}
            </p>
          </div>
          <span className={`shrink-0 rounded-md px-3 py-1 text-xs ${a.reconocida
            ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
            : "bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100"}`}>
            {a.reconocida ? "Reconocida" : "Activa"}
          </span>
        </li>
      ))}
    </ul>
  );
}
