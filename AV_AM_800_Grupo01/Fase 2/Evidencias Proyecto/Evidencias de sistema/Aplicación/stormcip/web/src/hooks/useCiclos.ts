"use client";
// Lecturas en tiempo real para Central, Registros, Consumos y Predicción.
import { useEffect, useState } from "react";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Ciclo } from "@/lib/tipos";
import { ConfigCalculos, LineaPlanta, Modelos } from "@/lib/central";

export function useCiclosRecientes(n = 200) {
  const [ciclos, setCiclos] = useState<Ciclo[] | null>(null);
  useEffect(() => {
    const q = query(collection(db, "ciclos"), orderBy("inicio", "desc"), limit(n));
    return onSnapshot(q, (s) => setCiclos(s.docs.map((d) => ({ id: d.id, ...d.data() } as Ciclo))));
  }, [n]);
  return { ciclos: ciclos ?? [], cargando: ciclos === null };
}

export function useModelos() {
  const [modelos, setModelos] = useState<Modelos | null>(null);
  useEffect(() => onSnapshot(doc(db, "configuracion/modelos"),
    (s) => setModelos((s.data() ?? {}) as Modelos)), []);
  return { modelos: modelos ?? {}, cargando: modelos === null };
}

export function useConfigCalculos() {
  const [cfg, setCfg] = useState<ConfigCalculos | null>(null);
  useEffect(() => onSnapshot(doc(db, "configuracion/calculos"),
    (s) => setCfg((s.data() ?? {}) as ConfigCalculos)), []);
  return cfg;
}

/** Líneas de todas las plantas. No cambian durante la sesión: se leen una vez. */
export function useLineas() {
  const [lineas, setLineas] = useState<LineaPlanta[]>([]);
  useEffect(() => {
    let vigente = true;
    (async () => {
      const plantas = await getDocs(collection(db, "plantas"));
      const listas = await Promise.all(plantas.docs.map(async (p) => {
        const ls = await getDocs(collection(db, `plantas/${p.id}/lineas`));
        return ls.docs.map((l) => ({
          id: l.id, nombre: String(l.get("nombre") ?? l.id), plantaNombre: String(p.get("nombre") ?? p.id),
        }));
      }));
      if (vigente) setLineas(listas.flat());
    })();
    return () => { vigente = false; };
  }, []);
  return lineas;
}
