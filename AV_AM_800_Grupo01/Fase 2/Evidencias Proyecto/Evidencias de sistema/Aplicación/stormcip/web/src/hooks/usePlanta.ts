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

/**
 * Ciclos que empezaron dentro de un periodo, del más antiguo al más nuevo.
 * `hastaMs` null = sin tope (incluye el ciclo en curso). `desdeMs` null = no consultar.
 */
export function useCiclosPeriodo(desdeMs: number | null, hastaMs: number | null, tope = 400) {
  const clave = `${desdeMs}|${hastaMs}|${tope}`;
  const [snap, setSnap] = useState<{ clave: string; ciclos: CicloPlanta[]; error?: string } | null>(null);
  useEffect(() => {
    if (desdeMs === null) return;
    const filtros = [where("inicio", ">=", new Date(desdeMs)), ...(hastaMs !== null ? [where("inicio", "<=", new Date(hastaMs))] : [])];
    // Los más recientes primero para que el tope recorte lo antiguo, no lo último
    const q = query(collection(db, "ciclos"), ...filtros, orderBy("inicio", "desc"), limit(tope));
    return onSnapshot(q,
      (s) => setSnap({ clave, ciclos: s.docs.map((d) => ({ id: d.id, ...d.data() } as CicloPlanta)).filter((c) => c.v === 3).reverse() }),
      (e) => { console.error("No se pudieron leer los ciclos del periodo:", e); setSnap({ clave, ciclos: [], error: "No se pudieron leer los ciclos del periodo." }); });
  }, [desdeMs, hastaMs, tope, clave]);
  const vigente = desdeMs !== null && snap?.clave === clave ? snap : null;
  return { ciclos: vigente?.ciclos ?? [], cargando: desdeMs !== null && !vigente, error: vigente?.error, recortado: (vigente?.ciclos.length ?? 0) >= tope };
}

export const detenerCiclo =(id: string) => updateDoc(doc(db, "ciclos", id), { detener: true });
