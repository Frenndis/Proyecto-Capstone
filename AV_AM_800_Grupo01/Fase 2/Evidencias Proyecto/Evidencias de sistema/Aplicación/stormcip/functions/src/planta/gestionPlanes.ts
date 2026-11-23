// Planes de limpieza en Firestore: configuracion/planes guarda { planes: { id: Plan } }.
// Si el documento no existe se usan (y se siembran) los circuitos de motor.ts.
// La web lee el documento directo; escribe solo a través de estas funciones,
// que validan el plan antes de guardarlo.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { CIRCUITOS } from "./motor";
import { ErrorPlan, Plan, PlanEntrada, normalizarPlan, planDesdeDoc } from "./planes";

const ref = () => getFirestore().doc("configuracion/planes");
const porDefecto = (): Plan[] => CIRCUITOS.map((c) => ({ ...c, activo: true }));

/** Todos los planes, activos o no. Sin documento: los de fábrica. */
export async function cargarPlanes(): Promise<Plan[]> {
  const snap = await ref().get();
  const mapa = snap.get("planes") as Record<string, Record<string, unknown>> | undefined;
  if (!snap.exists || !mapa) return porDefecto();
  return Object.entries(mapa).flatMap(([id, d]) => {
    const p = planDesdeDoc(id, d);
    return p ? [p] : [];
  });
}

export const cargarPlan = async (id: string) => (await cargarPlanes()).find((p) => p.id === id);

async function sembrarSiFalta() {
  const db = getFirestore();
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref())).exists) return;
    tx.set(ref(), { planes: Object.fromEntries(porDefecto().map((p) => [p.id, p])), creadoEn: FieldValue.serverTimestamp() });
  });
}

const soloAdmin = (rol: unknown) => {
  if (rol !== "admin") throw new HttpsError("permission-denied", "Solo un administrador puede gestionar los planes de limpieza");
};

/** Deja en Firestore los planes de fábrica si aún no hay ninguno. Idempotente. */
export const asegurarPlanes = onCall(async (req) => {
  if (!req.auth?.token.rol) throw new HttpsError("permission-denied", "Se requiere una sesión con rol");
  await sembrarSiFalta();
  return { ok: true };
});

/** Crea un plan (sin `id` existente) o modifica uno. */
export const guardarPlan = onCall(async (req) => {
  soloAdmin(req.auth?.token.rol);
  const { plan, crear } = (req.data ?? {}) as { plan?: PlanEntrada; crear?: boolean };
  await sembrarSiFalta();
  const actuales = await cargarPlanes();
  let nuevo: Plan;
  try {
    const previo = crear ? undefined : actuales.find((p) => p.id === plan?.id);
    if (!crear && !previo) throw new HttpsError("not-found", "El plan que intentas modificar ya no existe");
    nuevo = normalizarPlan(plan as PlanEntrada, previo);
    if (crear && actuales.some((p) => p.id === nuevo.id)) throw new ErrorPlan(`Ya existe un plan con el identificador «${nuevo.id}»: cambia el nombre`);
  } catch (e) {
    if (e instanceof ErrorPlan) throw new HttpsError("invalid-argument", e.message);
    throw e;
  }
  await ref().update({
    [`planes.${nuevo.id}`]: { ...nuevo, actualizadoEn: FieldValue.serverTimestamp(), actualizadoPor: req.auth?.token.email ?? req.auth?.uid ?? "" },
  });
  return { ok: true, id: nuevo.id };
});

/** Quita el plan. Los ciclos ya registrados conservan su propia copia de la receta. */
export const eliminarPlan = onCall(async (req) => {
  soloAdmin(req.auth?.token.rol);
  const { id } = (req.data ?? {}) as { id?: string };
  if (!id || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) throw new HttpsError("invalid-argument", "Se requiere el identificador del plan");
  await sembrarSiFalta();
  const db = getFirestore();
  const enCurso = await db.collection("ciclos").where("lineaId", "==", id).where("estado", "==", "en_curso").limit(1).get();
  if (!enCurso.empty) throw new HttpsError("failed-precondition", "El plan tiene un ciclo en curso: espera a que termine");
  await ref().update({ [`planes.${id}`]: FieldValue.delete() });
  return { ok: true };
});
