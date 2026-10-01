"use client";
// Hooks de lectura en tiempo real. onSnapshot deja un canal abierto:
// cuando ingestLectura escribe en Firestore, React se re-renderiza solo.
import { useEffect, useState } from "react";
import {
  collection, doc, limit, onSnapshot, orderBy, query, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Alerta, Ciclo, Lectura, Umbrales } from "@/lib/tipos";

export function useCicloActivo() {
  const [ciclo, setCiclo] = useState<Ciclo | null>(null);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    const q = query(collection(db, "ciclos"), where("estado", "==", "en_curso"), limit(1));
    return onSnapshot(q, (s) => {
      const d = s.docs[0];
      setCiclo(d ? ({ id: d.id, ...d.data() } as Ciclo) : null);
      setCargando(false);
    }, () => setCargando(false));
  }, []);
  return { ciclo, cargando };
}

export function useLecturas(cicloId?: string, n = 60) {
  const [lecturas, setLecturas] = useState<Lectura[]>([]);
  useEffect(() => {
    if (!cicloId) return setLecturas([]);
    const q = query(
      collection(db, `ciclos/${cicloId}/lecturas`), orderBy("ts", "desc"), limit(n)
    );
    return onSnapshot(q, (s) =>
      // se invierte para graficar de más antiguo a más nuevo
      setLecturas(s.docs.map((d) => ({ id: d.id, ...d.data() } as Lectura)).reverse())
    );
  }, [cicloId, n]);
  return lecturas;
}

export function useAlertas(n = 15) {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  useEffect(() => {
    const q = query(
      collection(db, "alertas"), where("reconocida", "==", false),
      orderBy("ts", "desc"), limit(n)
    );
    return onSnapshot(q, (s) =>
      setAlertas(s.docs.map((d) => ({ id: d.id, ...d.data() } as Alerta)))
    );
  }, [n]);
  return alertas;
}

export function useUmbrales() {
  const [umbrales, setUmbrales] = useState<Umbrales>({});
  useEffect(() => onSnapshot(doc(db, "configuracion/umbrales"),
    (s) => setUmbrales((s.data() as Umbrales) ?? {})), []);
  return umbrales;
}
