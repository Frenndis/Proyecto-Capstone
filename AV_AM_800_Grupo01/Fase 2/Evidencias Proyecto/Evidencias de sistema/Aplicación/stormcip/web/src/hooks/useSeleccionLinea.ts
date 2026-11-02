"use client";
// Línea que muestra el dashboard, recordada en el navegador. La página se genera
// estática: el HTML y el primer render usan el valor por defecto y, ya en el
// cliente, React lo reemplaza por el guardado (useSyncExternalStore evita el
// desajuste de hidratación sin tocar el estado dentro de un efecto).
import { useCallback, useSyncExternalStore } from "react";
import { SELECCION_DEFECTO, SeleccionLinea, leerSeleccion } from "@/lib/lineas";

const CLAVE = "stormcip.linea";
const suscriptores = new Set<() => void>();
// Respaldo en memoria: sin almacenamiento (ventana privada, bloqueado) la
// selección igual cambia durante la sesión.
let actual: SeleccionLinea | null = null;

function leer(): SeleccionLinea {
  if (actual === null) {
    try { actual = leerSeleccion(localStorage.getItem(CLAVE)); } catch { actual = SELECCION_DEFECTO; }
  }
  return actual;
}
const suscribir = (cb: () => void) => { suscriptores.add(cb); return () => { suscriptores.delete(cb); }; };

export function useSeleccionLinea() {
  const seleccion = useSyncExternalStore(suscribir, leer, () => SELECCION_DEFECTO);
  const elegir = useCallback((sel: SeleccionLinea) => {
    actual = sel;
    try { localStorage.setItem(CLAVE, sel); } catch { /* sin almacenamiento */ }
    suscriptores.forEach((cb) => cb());
  }, []);
  return [seleccion, elegir] as const;
}
