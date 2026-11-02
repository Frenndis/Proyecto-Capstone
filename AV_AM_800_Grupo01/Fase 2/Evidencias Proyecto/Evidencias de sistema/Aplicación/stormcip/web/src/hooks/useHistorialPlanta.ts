"use client";
// Acumula, mientras el dashboard está abierto, las muestras del estado de planta
// del ciclo mostrado (ver lib/historialPlanta.ts). Se pierde al recargar la página.
import { useState } from "react";
import { EstadoProceso } from "@/lib/tipos";
import { procesoDelCiclo } from "@/lib/etapas";
import { HISTORIAL_VACIO, HistorialPlanta, agregarMuestra } from "@/lib/historialPlanta";

export function useHistorialPlanta(cicloId: string | undefined, proceso: EstadoProceso | null) {
  const [hist, setHist] = useState<HistorialPlanta>(HISTORIAL_VACIO);
  // Estado derivado de las props: se actualiza durante el render (no en un efecto)
  // solo cuando llega una muestra nueva; agregarMuestra devuelve el mismo objeto si no hay cambio.
  const siguiente = agregarMuestra(hist, cicloId ?? "", procesoDelCiclo(proceso, cicloId));
  if (siguiente !== hist) setHist(siguiente);
  return siguiente.lecturas;
}
