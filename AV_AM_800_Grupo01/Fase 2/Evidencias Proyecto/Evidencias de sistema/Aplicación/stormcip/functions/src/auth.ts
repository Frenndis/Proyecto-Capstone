import * as functionsV1 from "firebase-functions/v1";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ROLES, Rol } from "./types";

// Todo usuario nuevo parte como "visor" (si no tiene rol asignado ya)
export const onUserCreated = functionsV1
  .region("southamerica-west1")
  .auth.user()
  .onCreate(async (user) => {
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

// Solo admin cambia roles. El cliente debe refrescar el token: getIdToken(true)
export const setUserRole = onCall(async (req) => {
  if (req.auth?.token.rol !== "admin") {
    throw new HttpsError("permission-denied", "Solo un admin puede asignar roles");
  }
  const { uid, rol } = (req.data ?? {}) as { uid?: string; rol?: Rol };
  if (!uid || !rol || !ROLES.includes(rol)) {
    throw new HttpsError("invalid-argument", "Se requiere uid y rol (admin|operador|visor)");
  }
  await getAuth().setCustomUserClaims(uid, { rol });
  await getFirestore().doc(`users/${uid}`).set({ rol }, { merge: true });
  return { ok: true };
});
