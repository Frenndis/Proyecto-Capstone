"use client";
// Hooks de lectura en tiempo real. onSnapshot deja un canal abierto:
// cuando el backend escribe en Firestore, React se re-renderiza solo.
import { useEffect, useState } from "react";
import {
  collection, doc, limit, onSnapshot, orderBy, query, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ultimoFinalizado } from "@/lib/lineas";
import {
  Alerta, Ciclo, Lectura, SondaDispositivo, UltimaLecturaDispositivo, Umbrales,
} from "@/lib/tipos";

// Cada hook guarda su snapshot junto con la línea que consultó: si cambia la línea,
// el dato anterior deja de valer sin limpiar el estado dentro del efecto.
type Con<T> = { clave: string; valor: T } | null;
const claveLinea = (lineaId?: string) => lineaId ?? "";

/** Ciclo en curso. Con `lineaId`, solo el de esa línea (si no, el de cualquiera). */
export function useCicloActivo(lineaId?: string) {
  const [snap, setSnap] = useState<Con<Ciclo | null>>(null);
  const clave = claveLinea(lineaId);
  useEffect(() => {
    const filtros = [where("estado", "==", "en_curso"), ...(lineaId ? [where("lineaId", "==", lineaId)] : [])];
    const q = query(collection(db, "ciclos"), ...filtros, limit(1));
    return onSnapshot(q, (s) => {
      const d = s.docs[0];
      setSnap({ clave, valor: d ? ({ id: d.id, ...d.data() } as Ciclo) : null });
    }, () => setSnap({ clave, valor: null }));
  }, [lineaId, clave]);
  const vigente = snap?.clave === clave ? snap : null;
  return { ciclo: vigente?.valor ?? null, cargando: !vigente };
}

/** Id del ciclo en curso de una línea (para saber si se puede iniciar uno nuevo). */
export function useCicloEnCursoId(lineaId: string) {
  const { ciclo, cargando } = useCicloActivo(lineaId);
  return { cicloId: ciclo?.id ?? null, cargando };
}

/**
 * Ciclo a mostrar en el dashboard: el que está en curso y, si no hay ninguno, el
 * último finalizado. Con `lineaId`, solo de esa línea.
 *
 * Sin el fallback los indicadores nunca se ven: el trigger los calcula al pasar
 * a "finalizado", justo cuando useCicloActivo deja de devolver el ciclo. El
 * dashboard quedaba en "No hay ciclos en curso" con los datos ya en Firestore.
 *
 * Solo "finalizado": un ciclo abortado no tiene indicadores calculados (el
 * trigger no se dispara) y mostrarlo sería una pantalla vacía sin explicación.
 * Sin línea, la query usa el índice compuesto estado+inicio de firestore.indexes.json.
 * Con línea usa el de lineaId+inicio y elige el finalizado en el cliente entre los
 * 10 más recientes (así no hace falta un índice lineaId+estado+inicio).
 */
export function useCicloMostrado(lineaId?: string) {
  const { ciclo: activo, cargando: cargandoActivo } = useCicloActivo(lineaId);
  const [snap, setSnap] = useState<Con<Ciclo | null>>(null);
  const clave = claveLinea(lineaId);

  useEffect(() => {
    const q = lineaId
      ? query(collection(db, "ciclos"), where("lineaId", "==", lineaId), orderBy("inicio", "desc"), limit(10))
      : query(collection(db, "ciclos"), where("estado", "==", "finalizado"), orderBy("inicio", "desc"), limit(1));
    return onSnapshot(q, (s) => {
      const ciclos = s.docs.map((d) => ({ id: d.id, ...d.data() } as Ciclo));
      setSnap({ clave, valor: lineaId ? ultimoFinalizado(ciclos) : (ciclos[0] ?? null) });
    }, (e) => {
      // Sin este log, un permission-denied (usuario sin claim de rol) o un índice
      // faltante se ven igual que "no hay ciclos cerrados": pantalla vacía.
      console.error("No se pudo leer el último ciclo cerrado:", e);
      setSnap({ clave, valor: null });
    });
  }, [lineaId, clave]);

  const vigente = snap?.clave === clave ? snap : null;
  const cerrado = vigente?.valor ?? null;
  // `enVivo` distingue las dos fuentes: el dashboard cambia el encabezado según
  // si lo que se ve está pasando ahora o es un ciclo ya cerrado.
  const ciclo = activo ?? cerrado;
  return {
    ciclo,
    enVivo: Boolean(activo),
    cargando: cargandoActivo || (!activo && !vigente),
  };
}

// n alto: la tendencia muestra el ciclo desde su inicio, no solo lo último. Las
// más recientes siempre entran (orden descendente); el backend avisa en 5000.
export function useLecturas(cicloId?: string, n = 500) {
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

// Historial completo (reconocidas y no reconocidas, de todos los ciclos),
// a diferencia de useAlertas() que solo muestra lo pendiente. Sin `where`:
// cubierto por el índice automático de campo simple de Firestore, no hace
// falta agregar nada a firestore.indexes.json.
export function useHistorialAlertas(n = 30) {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  useEffect(() => {
    const q = query(collection(db, "alertas"), orderBy("hasta", "desc"), limit(n));
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

/**
 * Sondas configuradas en dispositivos/{id}. Solo un admin puede leer ese
 * documento (firestore.rules): sin permiso o sin documento, `sondas` queda
 * undefined y el dashboard muestra todo lo visto, como hace el backend.
 * `cargando` evita un parpadeo con tarjetas de sondas que el equipo ya no tiene.
 */
export function useSondasDispositivo(deviceId?: string) {
  // El snapshot se guarda con el deviceId que lo originó: si cambia el equipo, el
  // dato anterior deja de valer sin limpiar el estado dentro del efecto.
  const [snap, setSnap] = useState<{ deviceId: string; sondas: Record<string, SondaDispositivo> | undefined } | null>(null);
  useEffect(() => {
    if (!deviceId) return;
    return onSnapshot(doc(db, "dispositivos", deviceId), (s) => {
      setSnap({ deviceId, sondas: s.data()?.sondas as Record<string, SondaDispositivo> | undefined });
    }, (e) => {
      console.error("No se pudieron leer las sondas del dispositivo:", e);
      setSnap({ deviceId, sondas: undefined });
    });
  }, [deviceId]);
  const vigente = deviceId && snap?.deviceId === deviceId ? snap : null;
  return { sondas: vigente?.sondas, cargando: Boolean(deviceId) && !vigente };
}
