"use client";
// Planes de limpieza CIP: se leen en vivo de configuracion/planes y se escriben a través
// de las funciones guardarPlan / eliminarPlan, que validan en el servidor.
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";

export const TIPOS_FASE = ["Preenjuague", "Soda", "Monofase", "Enjuague", "Ácido", "Enjuague final", "Drenaje"] as const;
export type TipoFase = (typeof TIPOS_FASE)[number];
export const esQuimica = (n: string) => n === "Soda" || n === "Monofase" || n === "Ácido";

export type FasePlan = { n: string; s: number; t: number; c: number; q: number; min: number | null; enjuague: boolean };
export type Plan = {
  id: string; nombre: string; corto: string; area: string; receta: string; lead: string;
  fases: FasePlan[]; hora: number; libres: number[]; activo: boolean;
};

/** Lo que edita el formulario: texto tal como se escribe, la función lo valida y convierte. */
export type FaseForm = { n: string; min: string; t: string; c: string; tMin: string; q: string };
export type PlanForm = {
  id?: string; nombre: string; corto: string; area: string; receta: string; lead: string;
  hora: string; libres: number[]; activo: boolean; fases: FaseForm[];
};

const txt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
export const aFormulario = (p: Plan): PlanForm => ({
  id: p.id, nombre: p.nombre, corto: p.corto, area: p.area, receta: p.receta, lead: p.lead,
  hora: String(p.hora), libres: [...p.libres], activo: p.activo,
  fases: p.fases.map((f) => ({ n: f.n, min: txt(+(f.s / 60).toFixed(2)), t: txt(f.t), c: f.c > 0 ? txt(f.c) : "", tMin: txt(f.min), q: txt(f.q) })),
});
export const faseNueva = (n: string): FaseForm => ({
  n, min: "5", t: esQuimica(n) ? "70" : "30", c: esQuimica(n) ? "1" : "", tMin: esQuimica(n) ? "65" : "", q: n === "Drenaje" ? "4" : esQuimica(n) ? "26" : "24",
});
export const planNuevo = (): PlanForm => ({
  nombre: "", corto: "", area: "", receta: "", lead: "", hora: "8", libres: [], activo: true,
  fases: ["Preenjuague", "Soda", "Enjuague", "Ácido", "Enjuague final"].map(faseNueva),
});

let sembrando: Promise<unknown> | null = null;

export function usePlanes() {
  const [planes, setPlanes] = useState<Plan[] | null>(null);
  useEffect(() => onSnapshot(doc(db, "configuracion/planes"), (s) => {
    const mapa = s.get("planes") as Record<string, Plan> | undefined;
    if (!s.exists() || !mapa) {
      // Primera vez: la función deja en Firestore los planes de fábrica y este mismo listener los recibe
      sembrando ??= httpsCallable(functions, "asegurarPlanes")().catch((e) => { sembrando = null; console.error("No se pudieron cargar los planes:", e); });
      return;
    }
    setPlanes(Object.entries(mapa).map(([id, p]) => ({ ...p, id, activo: p.activo !== false }))
      .filter((p) => Array.isArray(p.fases) && p.fases.length > 0)
      .sort((a, b) => a.area.localeCompare(b.area, "es") || a.nombre.localeCompare(b.nombre, "es")));
  }, (e) => { console.error("No se pudieron leer los planes:", e); setPlanes([]); }), []);
  return { planes: planes ?? [], cargando: planes === null };
}

const mensaje = (e: unknown, defecto: string) => {
  const m = (e as { message?: string; code?: string });
  return m.code === "functions/internal" || !m.message ? defecto : m.message.replace(/\s*\[\d{3}\]$/, "");
};

/** Crea o modifica. Devuelve el texto del error, o null si se guardó. */
export async function guardarPlan(plan: PlanForm, crear: boolean): Promise<string | null> {
  try { await httpsCallable(functions, "guardarPlan")({ plan, crear }); return null; }
  catch (e) { return mensaje(e, "No se pudo guardar el plan."); }
}
export async function eliminarPlan(id: string): Promise<string | null> {
  try { await httpsCallable(functions, "eliminarPlan")({ id }); return null; }
  catch (e) { return mensaje(e, "No se pudo eliminar el plan."); }
}
