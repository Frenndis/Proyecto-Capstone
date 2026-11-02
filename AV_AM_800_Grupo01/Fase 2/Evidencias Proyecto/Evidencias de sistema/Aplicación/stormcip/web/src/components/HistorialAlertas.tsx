"use client";
import { Alerta, ETAPA_LABEL, META, formatear, limiteAlerta } from "@/lib/tipos";

// Solo lectura: a diferencia de PanelAlertas, acá no se reconoce nada.
// Muestra el cicloId porque, al no estar acotado a un ciclo, hace falta
// para saber de qué lavado vino cada fila.
export default function HistorialAlertas({ alertas }: { alertas: Alerta[] }) {
  if (!alertas.length)
    return <p className="text-sm text-ink-3">Sin alertas registradas.</p>;

  return (
    <ul className="space-y-2">
      {alertas.map((a) => (
        <li key={a.id} className={`flex items-center justify-between gap-3 rounded-ctrl
                                    border p-3 text-sm ${a.reconocida
            ? "border-line bg-paper"
            : "border-warn bg-warn/10"}`}>
          <div>
            <p className="sc-eyebrow">
              {META[a.variable]?.label ?? a.variable}:{" "}
              {formatear(a.variable, a.ultimoValor)} {META[a.variable]?.unidad}
              {typeof a.conteo === "number" && a.conteo > 1 && (
                <span className="ml-2 rounded-ctrl bg-raise px-2 py-0.5 text-[10px]
                                 text-ink-2">
                  ×{a.conteo}
                </span>
              )}
            </p>
            <p className="text-xs text-ink-2">
              {a.cicloId} · {ETAPA_LABEL[a.etapa] ?? a.etapa} · límite {limiteAlerta(a)} ·
              {" desde "}
              {a.desde?.toDate ? a.desde.toDate().toLocaleTimeString("es-CL") : "—"}
              {a.hasta?.toDate && ` · última ${a.hasta.toDate().toLocaleTimeString("es-CL")}`}
            </p>
          </div>
          <span className={`shrink-0 rounded-ctrl px-3 py-1 text-xs ${a.reconocida
            ? "bg-raise text-ink-2"
            : "bg-warn/10 text-warn"}`}>
            {a.reconocida ? "Reconocida" : "Activa"}
          </span>
        </li>
      ))}
    </ul>
  );
}
