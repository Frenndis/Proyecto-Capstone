import * as functionsV1 from "firebase-functions/v1";
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { getAuth, UserRecord } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ROLES, Rol } from "./types";

// Todo usuario nuevo parte como "visor" (si no tiene rol asignado ya)
//
// Región distinta al resto (southamerica-east1, no -west1): el trigger
// `auth.user().onCreate` solo existe en Cloud Functions 1ª generación, y
// southamerica-west1 no admite 1ª generación (solo 2ª gen). No mover esto a
// Santiago aunque las demás funciones estén ahí.
export const onUserCreated = functionsV1
  .region("southamerica-east1")
  .auth.user()
  .onCreate(async (user) => {
    // crearUsuario deja users/{uid} con el rol ANTES de crear la cuenta: si el
    // documento ya existe, ese rol manda y no se pisa con "visor".
    const doc = await getFirestore().doc(`users/${user.uid}`).get();
    const previsto = doc.get("rol") as Rol | undefined;
    if (previsto && ROLES.includes(previsto)) {
      await getAuth().setCustomUserClaims(user.uid, { rol: previsto });
      return;
    }
    const actual = await getAuth().getUser(user.uid);
    if (!actual.customClaims?.rol) {
      await getAuth().setCustomUserClaims(user.uid, { rol: "visor" });
    }
    try {
      await getFirestore().doc(`users/${user.uid}`).create({
        email: user.email ?? null,
        nombre: user.displayName ?? null,
        rol: actual.customClaims?.rol ?? "visor",
        creadoEn: FieldValue.serverTimestamp(),
      });
    } catch { /* ya existe: no se sobreescribe */ }
  });

function exigirAdmin(req: CallableRequest): string {
  if (!req.auth || req.auth.token.rol !== "admin") {
    throw new HttpsError("permission-denied", "Solo un administrador puede gestionar usuarios");
  }
  return req.auth.uid;
}

export type UsuarioLista = {
  uid: string; email: string | null; nombre: string | null; rol: Rol | null;
  activo: boolean; creadoMs: number | null; ultimoIngresoMs: number | null;
};

const ms = (s?: string | null) => (s ? Date.parse(s) || null : null);
const aLista = (u: UserRecord): UsuarioLista => ({
  uid: u.uid, email: u.email ?? null, nombre: u.displayName ?? null,
  rol: ROLES.includes(u.customClaims?.rol) ? (u.customClaims?.rol as Rol) : null,
  activo: !u.disabled, creadoMs: ms(u.metadata.creationTime), ultimoIngresoMs: ms(u.metadata.lastSignInTime),
});

async function todosLosUsuarios(): Promise<UserRecord[]> {
  const out: UserRecord[] = [];
  let pagina: string | undefined;
  do {
    const r = await getAuth().listUsers(1000, pagina);
    out.push(...r.users);
    pagina = r.pageToken;
  } while (pagina && out.length < 5000);
  return out;
}

/** Quedaría la planta sin nadie que administre si `uid` deja de ser admin activo. */
async function esUltimoAdmin(uid: string): Promise<boolean> {
  const admins = (await todosLosUsuarios()).filter((u) => u.customClaims?.rol === "admin" && !u.disabled);
  return admins.length === 1 && admins[0].uid === uid;
}

/** Lista de cuentas desde Auth (la fuente de verdad del rol es el claim). */
export const listarUsuarios = onCall(async (req) => {
  exigirAdmin(req);
  const usuarios = (await todosLosUsuarios()).map(aLista)
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
  return { usuarios };
});

/** Alta de una cuenta con su rol. El usuario cambia la contraseña temporal al entrar. */
export const crearUsuario = onCall(async (req) => {
  const por = exigirAdmin(req);
  const { email, nombre, rol, password } = (req.data ?? {}) as { email?: string; nombre?: string; rol?: Rol; password?: string };
  const correo = (email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new HttpsError("invalid-argument", "El correo no es válido");
  if (!rol || !ROLES.includes(rol)) throw new HttpsError("invalid-argument", "El rol debe ser admin, operador o visor");
  if (typeof password !== "string" || password.length < 8) throw new HttpsError("invalid-argument", "La contraseña temporal necesita al menos 8 caracteres");
  const visible = (nombre ?? "").trim().slice(0, 80);

  const db = getFirestore();
  const ref = db.collection("users").doc();
  // El documento va primero: onUserCreated lo lee para no dejar la cuenta como "visor"
  await ref.set({ email: correo, nombre: visible || null, rol, creadoEn: FieldValue.serverTimestamp(), creadoPor: por });
  try {
    await getAuth().createUser({ uid: ref.id, email: correo, password, ...(visible ? { displayName: visible } : {}) });
  } catch (e: unknown) {
    await ref.delete();
    const code = (e as { code?: string }).code;
    if (code === "auth/email-already-exists") throw new HttpsError("already-exists", "Ya existe una cuenta con ese correo");
    if (code === "auth/invalid-password") throw new HttpsError("invalid-argument", "La contraseña temporal no es válida");
    throw new HttpsError("internal", "No se pudo crear la cuenta");
  }
  await getAuth().setCustomUserClaims(ref.id, { rol });
  return { ok: true, uid: ref.id };
});

// Solo admin cambia roles. El cliente debe refrescar el token: getIdToken(true)
export const setUserRole = onCall(async (req) => {
  if (req.auth?.token.rol !== "admin") {
    throw new HttpsError("permission-denied", "Solo un admin puede asignar roles");
  }
  const { uid, rol } = (req.data ?? {}) as { uid?: string; rol?: Rol };
  if (!uid || !rol || !ROLES.includes(rol)) {
    throw new HttpsError("invalid-argument", "Se requiere uid y rol (admin|operador|visor)");
  }
  if (rol !== "admin" && await esUltimoAdmin(uid)) {
    throw new HttpsError("failed-precondition", "Es el único administrador activo: asigna otro antes de cambiarle el rol");
  }
  await getAuth().setCustomUserClaims(uid, { rol });
  await getFirestore().doc(`users/${uid}`).set({ rol }, { merge: true });
  return { ok: true };
});

/** Activa o desactiva una cuenta. Desactivar cierra también sus sesiones abiertas. */
export const setUserActivo = onCall(async (req) => {
  const por = exigirAdmin(req);
  const { uid, activo } = (req.data ?? {}) as { uid?: string; activo?: boolean };
  if (!uid || typeof activo !== "boolean") throw new HttpsError("invalid-argument", "Se requiere uid y activo");
  if (!activo) {
    if (uid === por) throw new HttpsError("failed-precondition", "No puedes desactivar tu propia cuenta");
    if (await esUltimoAdmin(uid)) throw new HttpsError("failed-precondition", "Es el único administrador activo");
  }
  await getAuth().updateUser(uid, { disabled: !activo });
  if (!activo) await getAuth().revokeRefreshTokens(uid);
  await getFirestore().doc(`users/${uid}`).set({ activo }, { merge: true });
  return { ok: true };
});
