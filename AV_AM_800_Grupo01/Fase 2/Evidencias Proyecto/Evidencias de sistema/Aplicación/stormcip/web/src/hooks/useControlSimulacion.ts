"use client";
// Control de la demo: estado y latido del simulador (simulacionEstado/{linea}) y
// órdenes hacia él (simulacionControl/{linea}). Solo un admin puede escribir las
// órdenes (firestore.rules); el simulador (sim:cip --esperar) las ejecuta.
import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  Escenario, EstadoSimulador, Pendiente, SIN_LATIDO, SeguimientoLatido, armarOrden, latidoVivo,
  resultadoDeOrden, seguirLatido,
} from "@/lib/controlSimulacion";
import { useAhora } from "./useAhora";

type Snap = { linea: string; estado: EstadoSimulador | undefined; seguimiento: SeguimientoLatido };

export function useControlSimulacion(lineaId: string) {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const ahora = useAhora(1000);

  useEffect(() => {
    return onSnapshot(
      doc(db, "simulacionEstado", lineaId),
      (s) => {
        const estado = s.exists() ? (s.data() as EstadoSimulador) : undefined;
        setSnap((prev) => ({
          linea: lineaId, estado,
          seguimiento: seguirLatido(prev?.linea === lineaId ? prev.seguimiento : SIN_LATIDO, estado?.latido, Date.now()),
        }));
      },
      (e) => {
        console.error("No se pudo leer el estado del simulador:", e);
        setSnap({ linea: lineaId, estado: undefined, seguimiento: SIN_LATIDO });
      },
    );
  }, [lineaId]);

  const vigente = snap?.linea === lineaId ? snap : null;
  const estado = vigente?.estado;
  const vivo = vigente ? latidoVivo(vigente.seguimiento, ahora) : false;
  const resultado = resultadoDeOrden(pendiente, estado, ahora);
  const esperandoRespuesta = resultado?.tipo === "esperando";

  const enviar = useCallback(async (comando: "iniciar" | "detener", escenario: Escenario | null) => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setErrorEnvio("No hay una sesión activa."); return; }
    const solicitudId = crypto.randomUUID();
    setErrorEnvio(null);
    setPendiente({ solicitudId, enviadaMs: Date.now() });
    try {
      await setDoc(doc(db, "simulacionControl", lineaId), {
        ...armarOrden(comando, escenario, solicitudId, uid), solicitadoEn: serverTimestamp(),
      });
    } catch (e) {
      setPendiente(null);
      setErrorEnvio(`No se pudo enviar la orden: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [lineaId]);

  return { estado, vivo, resultado, esperandoRespuesta, errorEnvio, enviar, cargando: !vigente };
}
