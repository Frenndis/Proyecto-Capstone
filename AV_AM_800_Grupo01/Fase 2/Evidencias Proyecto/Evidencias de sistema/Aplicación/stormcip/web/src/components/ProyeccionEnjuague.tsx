"use client";
import { AvisoProyeccion } from "@/lib/proyeccionEnjuague";

// Lo estimado lleva las tres señales de IndicadoresCiclo (borde punteado, ámbar y ≈):
// el color solo no sobrevive a una captura en blanco y negro ni al daltonismo.
const ESTILO: Record<AvisoProyeccion["tono"], string> = {
  estimado: "border border-dashed border-warn text-warn",
  listo: "border border-ok text-ok",
  alerta: "border border-crit text-crit",
  neutro: "border border-line text-ink-2",
};

export default function ProyeccionEnjuague({ aviso }: { aviso: AvisoProyeccion | null }) {
  if (!aviso) return null;
  return (
    <section className={`rounded-card bg-surface p-4 ${ESTILO[aviso.tono]}`}>
      <h2 className="sc-eyebrow">Fin del enjuague</h2>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{aviso.titulo}</p>
      <p className="mt-1 text-sm text-ink-3">{aviso.detalle}</p>
    </section>
  );
}
