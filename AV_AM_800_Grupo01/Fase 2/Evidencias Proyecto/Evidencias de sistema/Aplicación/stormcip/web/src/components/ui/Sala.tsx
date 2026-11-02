// Piezas comunes de la «Sala de Control»: tarjeta, KPI y estado con punto.
import { EstadoCiclo } from "@/lib/central";

export function Tarjeta({ titulo, derecha, children, className = "" }: {
  titulo?: string; derecha?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`sc-card ${className}`}>
      {titulo && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="sc-eyebrow">{titulo}</h2>
          {derecha && <div className="text-xs text-ink-3">{derecha}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ etiqueta, valor, unidad, detalle, tono }: {
  etiqueta: string; valor: string | number; unidad?: string; detalle?: string; tono?: "ok" | "warn" | "crit";
}) {
  const color = tono === "ok" ? "text-ok" : tono === "warn" ? "text-warn" : tono === "crit" ? "text-crit" : "";
  return (
    <div className="px-4 py-3">
      <p className="sc-eyebrow">{etiqueta}</p>
      <p className={`sc-kpi mt-1 ${color}`}>
        {valor}{unidad && <span className="ml-1 text-sm font-normal text-ink-3">{unidad}</span>}
      </p>
      {detalle && <p className="mt-0.5 text-xs text-ink-3">{detalle}</p>}
    </div>
  );
}

export function FilaKpi({ children }: { children: React.ReactNode }) {
  return (
    <div className="sc-card grid grid-cols-2 divide-line max-md:[&>*:nth-child(n+3)]:border-t md:grid-cols-4 md:divide-x">
      {children}
    </div>
  );
}

const TONO: Record<EstadoCiclo["tono"], string> = {
  ok: "text-ok", warn: "text-warn", crit: "text-crit", accent: "text-accent-ink", neutro: "text-ink-3",
};

export function Estado({ tono, texto }: EstadoCiclo) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold ${TONO[tono]}`}>
      <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{texto}
    </span>
  );
}

/** Marca fija: todo lo que venga de la simulación se declara, en cualquier pantalla. */
export function Simulado() {
  return (
    <span className="inline-flex rounded-ctrl border border-warn/50 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-warn">
      Datos simulados
    </span>
  );
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-ink-3">{children}</p>;
}
