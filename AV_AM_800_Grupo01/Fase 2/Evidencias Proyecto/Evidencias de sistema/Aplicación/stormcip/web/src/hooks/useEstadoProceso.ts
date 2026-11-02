"use client";
// Estado de planta en vivo (estadoProceso/{lineaId}): lo que vendría del PLC,
// hoy escrito por scripts/simulador-cip.js.
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { EstadoProceso, estaDetenido } from "@/lib/tipos";

export function useEstadoProceso(lineaId?: string) {
  // El snapshot se guarda junto con su lineaId: si cambia la línea, el dato
  // anterior deja de valer sin tener que limpiar el estado dentro del efecto.
  const [snap, setSnap] = useState<{ lineaId: string; estado: EstadoProceso | null } | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    if (!lineaId) return;
    return onSnapshot(
      doc(db, "estadoProceso", lineaId),
      (s) => setSnap({ lineaId, estado: s.exists() ? (s.data() as EstadoProceso) : null }),
      () => setSnap({ lineaId, estado: null }),
    );
  }, [lineaId]);

  // Si el simulador (o el PLC) se cae no llegan más snapshots: sin este reloj,
  // `detenido` nunca pasaría a true.
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const vigente = lineaId && snap?.lineaId === lineaId ? snap : null;
  const estado = vigente?.estado ?? null;
  const cargando = !!lineaId && !vigente;
  const detenido = !estado || estaDetenido(estado.actualizadoEn, ahora);
  return { estado, cargando, detenido };
}
