"use client";
// Hooks de lectura en tiempo real. onSnapshot deja un canal abierto:
// cuando el backend escribe en Firestore, React se re-renderiza solo.
import { useEffect, useState } from "react";
import {
  collection, doc, limit, onSnapshot, orderBy, query, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Alerta, Ciclo, Lectura, UltimaLecturaDispositivo, Umbrales } from "@/lib/tipos";

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

/**
 * Ciclo a mostrar en el dashboard: el que está en curso y, si no hay ninguno, el
 * último finalizado.
 *
 * Sin el fallback los indicadores nunca se ven: el trigger los calcula al pasar
 * a "finalizado", justo cuando useCicloActivo deja de devolver el ciclo. El
 * dashboard quedaba en "No hay ciclos en curso" con los datos ya en Firestore.
 *
 * Solo "finalizado": un ciclo abortado no tiene indicadores calculados (el
 * trigger no se dispara) y mostrarlo sería una pantalla vacía sin explicación.
 * La query usa el índice compuesto estado+inicio de firestore.indexes.json.
 */
export function useCicloMostrado() {
  const { ciclo: activo, cargando: cargandoActivo } = useCicloActivo();
  const [cerrado, setCerrado] = useState<Ciclo | null>(null);
  const [cargandoCerrado, setCargandoCerrado] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "ciclos"), where("estado", "==", "finalizado"),
      orderBy("inicio", "desc"), limit(1)
    );
    return onSnapshot(q, (s) => {
      const d = s.docs[0];
      setCerrado(d ? ({ id: d.id, ...d.data() } as Ciclo) : null);
      setCargandoCerrado(false);
    }, (e) => {
      // Sin este log, un permission-denied (usuario sin claim de rol) o un índice
      // faltante se ven igual que "no hay ciclos cerrados": pantalla vacía.
      console.error("No se pudo leer el último ciclo cerrado:", e);
      setCargandoCerrado(false);
    });
  }, []);

  // `enVivo` distingue las dos fuentes: el dashboard cambia el encabezado según
  // si lo que se ve está pasando ahora o es un ciclo ya cerrado.
  const ciclo = activo ?? cerrado;
  return {
    ciclo,
    enVivo: Boolean(activo),
    cargando: cargandoActivo || (!activo && cargandoCerrado),
  };
}

export function useLecturas(cicloId?: string, n = 60) {
  const [lecturas, setLecturas] = useState<Lectura[]>([]);
  useEffect(() => {
    if (!cicloId) { setLecturas([]); return; }
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

// v2: las alertas se actualizan mientras la condición dura, así que el orden
// es por `hasta` (última vez vista), no por un `ts` de creación.
export function useAlertas(n = 15) {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  useEffect(() => {
    const q = query(
      collection(db, "alertas"), where("reconocida", "==", false),
      orderBy("hasta", "desc"), limit(n)
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

/**
 * v2: `ultimaLectura` está anidada por deviceId para que dos equipos de la
 * misma línea no se pisen. Devuelve la más reciente entre todos los equipos,
 * junto con el id del dispositivo que la envió.
 */
export function ultimaLecturaReciente(
  ultimaLectura?: Record<string, UltimaLecturaDispositivo>
): { deviceId?: string; lectura?: UltimaLecturaDispositivo } {
  const entradas = Object.entries(ultimaLectura ?? {});
  if (!entradas.length) return {};
  const ms = (t: any) => (t?.toMillis ? t.toMillis() : 0);
  const [deviceId, lectura] = entradas.reduce((a, b) =>
    ms(b[1]?.ts) > ms(a[1]?.ts) ? b : a
  );
  return { deviceId, lectura };
}
