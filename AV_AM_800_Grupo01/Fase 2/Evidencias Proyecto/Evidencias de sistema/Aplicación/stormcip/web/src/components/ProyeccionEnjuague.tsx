"use client";
import { AvisoProyeccion } from "@/lib/proyeccionEnjuague";

// Lo estimado lleva las tres señales de IndicadoresCiclo (borde punteado, ámbar y ≈):
// el color solo no sobrevive a una captura en blanco y negro ni al daltonismo.
const ESTILO: Record<AvisoProyeccion["tono"], string> = {
  estimado: "border border-dashed border-amber-600 text-amber-700 dark:border-amber-400 dark:text-amber-300",
  listo: "border border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300",
  alerta: "border-2 border-red-600 text-red-700 dark:border-red-400 dark:text-red-300",
  neutro: "border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300",
};

export default function ProyeccionEnjuague({ aviso }: { aviso: AvisoProyeccion | null }) {
  if (!aviso) return null;
  return (
    <section className={`rounded-xl p-4 ${ESTILO[aviso.tono]}`}>
      <h2 className="text-xs font-medium uppercase tracking-wide opacity-80">Fin del enjuague</h2>
      <p className="mt-1 text-lg font-semibold tabular-nums">{aviso.titulo}</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{aviso.detalle}</p>
    </section>
  );
}
