"use client";
import { useConfigCalculos } from "@/hooks/useCiclos";
import { useUmbrales } from "@/hooks/useDatosCip";
import { Tarjeta, Vacio } from "@/components/ui/Sala";
import { ETAPA_LABEL, META, Rango } from "@/lib/tipos";

const rango = (r: Rango) =>
  r.min !== undefined && r.max !== undefined ? `${r.min} a ${r.max}`
  : r.max !== undefined ? `máx. ${r.max}` : r.min !== undefined ? `mín. ${r.min}` : "—";

export default function ConfiguracionPage() {
  const cfg = useConfigCalculos();
  const umbrales = useUmbrales();
  const filas = Object.entries(umbrales).flatMap(([etapa, vars]) =>
    Object.entries(vars).map(([v, r]) => ({ etapa, v, r })));
  const parametros = [
    ["Conductividad del agua de red", cfg?.conductividadAguaRed, "µS/cm"],
    ["Criterio de agua limpia", cfg?.criterioLimpio?.conductividad25C, "µS/cm a 25 °C"],
    ["Caudal nominal", cfg?.caudalNominalM3h, "m³/h"],
    ["Compensación de temperatura", cfg?.factorCompensacionEC, "por °C"],
  ] as const;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Tarjeta titulo="Parámetros de cálculo" derecha="supuestos por confirmar con la planta">
        <table className="sc-table">
          <tbody>
            {parametros.map(([k, v, u]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="num font-semibold">{v ?? "—"}</td>
                <td className="text-ink-3">{u}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tarjeta>
      <Tarjeta titulo="Umbrales de alerta por etapa">
        {filas.length === 0 ? <Vacio>Sin umbrales configurados.</Vacio> : (
          <table className="sc-table">
            <thead><tr><th>Etapa</th><th>Variable</th><th className="text-right">Rango</th></tr></thead>
            <tbody>
              {filas.map(({ etapa, v, r }) => (
                <tr key={`${etapa}-${v}`}>
                  <td>{ETAPA_LABEL[etapa] ?? etapa}</td>
                  <td>{META[v]?.label ?? v}</td>
                  <td className="num">{rango(r)} {META[v]?.unidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>
    </div>
  );
}
