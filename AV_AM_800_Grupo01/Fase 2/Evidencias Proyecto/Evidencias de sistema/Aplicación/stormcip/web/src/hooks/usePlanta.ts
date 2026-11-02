"use client";
// Lecturas en tiempo real de la planta. Solo ciclos con esquema v3: los anteriores
// (sensores de la línea piloto) siguen en /sensores.
import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "@/lib/firebase";
import { CicloPlanta, EstadoDecision, Oportunidades } from "@/lib/planta";

export function useCiclosPlanta(n = 600) {
  const [ciclos, setCiclos] = useState<CicloPlanta[] | null>(null);
  useEffect(() => {
    const q = query(collection(db, "ciclos"), orderBy("inicio", "desc"), limit(n));
    return onSnapshot(q, (s) => setCiclos(s.docs.map((d) => ({ id: d.id, ...d.data() } as CicloPlanta)).filter((c) => c.v === 3)));
  }, [n]);
  return { ciclos: ciclos ?? [], cargando: ciclos === null };
}

/** Ciclos desde el inicio de hoy: lo que necesitan Central y la barra superior. */
export function useCiclosHoy() {
  const [ciclos, setCiclos] = useState<CicloPlanta[] | null>(null);
  useEffect(() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const q = query(collection(db, "ciclos"), where("inicio", ">=", hoy), orderBy("inicio", "asc"));
    return onSnapshot(q, (s) => setCiclos(s.docs.map((d) => ({ id: d.id, ...d.data() } as CicloPlanta)).filter((c) => c.v === 3)));
  }, []);
  return { ciclos: ciclos ?? [], cargando: ciclos === null };
}

export function useOportunidades() {
  const [o, setO] = useState<Oportunidades | null>(null);
  const [cargando, setCargando] = useState(true);
  useEffect(() => onSnapshot(doc(db, "configuracion/oportunidades"), (s) => {
    setO(s.exists() ? (s.data() as Oportunidades) : null); setCargando(false);
  }), []);
  return { oportunidades: o, cargando };
}

export function useEstadosDecision() {
  const [e, setE] = useState<Record<string, EstadoDecision>>({});
  useEffect(() => onSnapshot(doc(db, "configuracion/decisiones"), (s) => setE((s.data() ?? {}) as Record<string, EstadoDecision>)), []);
  return e;
}

/** Deja constancia de quién decidió. No cambia la receta ni el PLC. */
export const registrarDecision = (id: string, estado: "aprobada" | "descartada" | null) =>
  setDoc(doc(db, "configuracion/decisiones"), {
    [id]: estado ? { estado, por: auth.currentUser?.email ?? "", en: serverTimestamp() } : { estado: "pendiente" },
  }, { merge: true });

export const iniciarCiclo = (circuitoId: string, escenario: string) =>
  httpsCallable(functions, "iniciarCicloDemo", { timeout: 540000 })({ circuitoId, escenario });

export const detenerCiclo = (id: string) => updateDoc(doc(db, "ciclos", id), { detener: true });
