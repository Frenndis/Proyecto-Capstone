// Lógica pura del aviso "Fin del enjuague": qué decirle al operador según la
// proyección que deja el trigger alCrearLectura (functions/src/proyeccionEnjuague.ts).
// Sin React ni Firestore, para poder testearla.
import { Ciclo, ETAPA_LABEL } from "./tipos";

export type AvisoProyeccion = {
  tono: "estimado" | "listo" | "alerta" | "neutro";
  titulo: string;
  detalle: string;
};

/** "45 s" bajo un minuto; "11 min" desde ahí, redondeado. */
export function formatearDuracion(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  return `${Math.round(s / 60)} min`;
}

/**
 * Aviso para el equipo y la etapa en curso. null si no hay nada que informar:
 * ciclo cerrado, etapa química o proyección de una etapa anterior.
 */
export function avisoProyeccion(
  ciclo: Pick<Ciclo, "etapaActual" | "proyeccionEnjuague"> | null | undefined,
  deviceId: string | undefined,
  enVivo: boolean,
): AvisoProyeccion | null {
  const p = deviceId ? ciclo?.proyeccionEnjuague?.[deviceId] : undefined;
  if (!enVivo || !p || p.etapa !== ciclo?.etapaActual) return null;
  const etapa = ETAPA_LABEL[p.etapa] ?? p.etapa;

  switch (p.estado) {
    case "proyectando":
      return {
        tono: "estimado",
        titulo: (p.restanteS ?? 0) > 0
          ? `≈ ${formatearDuracion(p.restanteS ?? 0)} para agua limpia`
          : "≈ A punto de llegar a agua limpia",
        detalle: `${etapa}: entre ${formatearDuracion(p.restanteMinS ?? 0)} y ${formatearDuracion(p.restanteMaxS ?? 0)}, ` +
          `según ${p.muestras} lecturas. ${p.metodo ?? ""}`.trim(),
      };
    case "limpio":
      return {
        tono: "listo",
        titulo: "Criterio de agua limpia cumplido",
        detalle: `${etapa}: ${p.metodo ?? "la última lectura cumple el criterio"}. La duración de la etapa no cambia automáticamente.`,
      };
    case "turbidez_pendiente":
      return { tono: "neutro", titulo: "Falta la turbidez", detalle: `${etapa}: la conductividad ya cumple, pero la turbidez todavía no.` };
    case "no_converge":
      return {
        tono: "alerta",
        titulo: "Sin proyección confiable",
        detalle: `${etapa}: la conductividad no baja como un enjuague normal. Revisa la línea y el agua de entrada.`,
      };
    case "sin_criterio":
      return {
        tono: "alerta",
        titulo: "Revisar la configuración",
        detalle: "El criterio de agua limpia no supera la conductividad configurada del agua de red.",
      };
    default:
      return { tono: "neutro", titulo: "Reuniendo lecturas", detalle: `${etapa}: se necesitan al menos 5 lecturas de la caída para proyectar.` };
  }
}
