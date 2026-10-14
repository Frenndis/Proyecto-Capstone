// Tests de firestore.rules contra el emulador de Firestore (debe estar corriendo).
// Corre con `npm run test:reglas` (desde functions/). Usa un proyecto "demo-..."
// propio: no toca los datos del emulador que se usa en desarrollo (stormcip-dev).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { Timestamp, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let env: RulesTestEnvironment;

const HOST = process.env.FIRESTORE_EMULATOR_HOST?.split(":")[0] ?? "127.0.0.1";
const PORT = Number(process.env.FIRESTORE_EMULATOR_HOST?.split(":")[1] ?? 8080);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-stormcip-reglas",
    firestore: {
      host: HOST, port: PORT,
      rules: readFileSync(resolve(__dirname, "..", "..", "firestore.rules"), "utf8"),
    },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const como = (uid: string, rol: string) => env.authenticatedContext(uid, { rol }).firestore();
const admin = () => como("u-admin", "admin");
const operador = () => como("u-oper", "operador");
const visor = () => como("u-visor", "visor");
const anonimo = () => env.unauthenticatedContext().firestore();

/** Crea documentos saltándose las reglas (datos de partida de cada test). */
const sembrar = (ruta: string, datos: Record<string, unknown>) =>
  env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), ruta), datos); });

describe("ciclos", () => {
  const ciclo = { lineaId: "cip-01", estado: "en_curso", etapaActual: "enjuague" };

  it("admin y operador crean y actualizan", async () => {
    await assertSucceeds(setDoc(doc(admin(), "ciclos/C1"), ciclo));
    await assertSucceeds(setDoc(doc(operador(), "ciclos/C2"), ciclo));
    await assertSucceeds(updateDoc(doc(operador(), "ciclos/C1"), { etapaActual: "enjuague_final" }));
  });

  it("el visor y el anónimo no escriben", async () => {
    await assertFails(setDoc(doc(visor(), "ciclos/C1"), ciclo));
    await assertFails(setDoc(doc(anonimo(), "ciclos/C1"), ciclo));
  });

  it("nadie borra un ciclo, ni siquiera un admin", async () => {
    await sembrar("ciclos/C1", ciclo);
    await assertFails(deleteDoc(doc(admin(), "ciclos/C1")));
    await assertFails(deleteDoc(doc(operador(), "ciclos/C1")));
  });

  it("lee quien tiene un rol; el anónimo no", async () => {
    await sembrar("ciclos/C1", ciclo);
    await assertSucceeds(getDoc(doc(visor(), "ciclos/C1")));
    await assertFails(getDoc(doc(anonimo(), "ciclos/C1")));
  });

  it("las lecturas solo las escribe el backend", async () => {
    await assertFails(setDoc(doc(admin(), "ciclos/C1/lecturas/L1"), { v: 2 }));
  });
});

describe("reglas existentes que no deben cambiar", () => {
  it("alertas: el operador solo puede reconocer", async () => {
    await sembrar("alertas/A1", { cicloId: "C1", reconocida: false, ultimoValor: 5 });
    await assertSucceeds(updateDoc(doc(operador(), "alertas/A1"), { reconocida: true, reconocidaPor: "u-oper" }));
    await assertFails(updateDoc(doc(operador(), "alertas/A1"), { ultimoValor: 99 }));
    await assertFails(setDoc(doc(admin(), "alertas/A2"), { cicloId: "C1" }));
  });

  it("dispositivos: solo lee un admin y nadie escribe", async () => {
    await sembrar("dispositivos/d1", { lineaId: "cip-01" });
    await assertSucceeds(getDoc(doc(admin(), "dispositivos/d1")));
    await assertFails(getDoc(doc(operador(), "dispositivos/d1")));
    await assertFails(setDoc(doc(admin(), "dispositivos/d1"), { lineaId: "x" }));
  });

  it("estadoProceso: lee quien tiene rol, nadie escribe", async () => {
    await sembrar("estadoProceso/cip-01", { etapa: "enjuague" });
    await assertSucceeds(getDoc(doc(visor(), "estadoProceso/cip-01")));
    await assertFails(setDoc(doc(admin(), "estadoProceso/cip-01"), { etapa: "x" }));
  });

  it("configuracion: lee quien tiene rol, escribe solo el admin", async () => {
    await sembrar("configuracion/umbrales", { enjuague: {} });
    await assertSucceeds(getDoc(doc(visor(), "configuracion/umbrales")));
    await assertSucceeds(setDoc(doc(admin(), "configuracion/umbrales"), { enjuague: {} }));
    await assertFails(setDoc(doc(operador(), "configuracion/umbrales"), { enjuague: {} }));
  });
});

describe("simulacionControl (orden del botón de la demo)", () => {
  const orden = (uid: string, extra: Record<string, unknown> = {}) => ({
    comando: "iniciar", escenario: "normal", solicitudId: "abcdef12-0001",
    solicitadoPor: uid, solicitadoEn: serverTimestamp(), ...extra,
  });
  const ruta = "simulacionControl/cip-sim";

  it("un admin inicia con escenario normal o falla", async () => {
    await assertSucceeds(setDoc(doc(admin(), ruta), orden("u-admin")));
    await assertSucceeds(setDoc(doc(admin(), ruta), orden("u-admin", { escenario: "falla", solicitudId: "abcdef12-0002" })));
  });

  it("un admin detiene, sin escenario", async () => {
    await assertSucceeds(setDoc(doc(admin(), ruta), {
      comando: "detener", solicitudId: "abcdef12-0003", solicitadoPor: "u-admin", solicitadoEn: serverTimestamp(),
    }));
  });

  it("el operador, el visor y el anónimo no escriben", async () => {
    await assertFails(setDoc(doc(operador(), ruta), orden("u-oper")));
    await assertFails(setDoc(doc(visor(), ruta), orden("u-visor")));
    await assertFails(setDoc(doc(anonimo(), ruta), orden("x")));
  });

  it("rechaza comando o escenario inválidos", async () => {
    await assertFails(setDoc(doc(admin(), ruta), orden("u-admin", { comando: "borrar" })));
    await assertFails(setDoc(doc(admin(), ruta), orden("u-admin", { escenario: "otro" })));
  });

  it("iniciar exige escenario", async () => {
    await assertFails(setDoc(doc(admin(), ruta), {
      comando: "iniciar", solicitudId: "abcdef12-0004", solicitadoPor: "u-admin", solicitadoEn: serverTimestamp(),
    }));
  });

  it("rechaza campos de más y campos de menos", async () => {
    await assertFails(setDoc(doc(admin(), ruta), orden("u-admin", { extra: 1 })));
    await assertFails(setDoc(doc(admin(), ruta), {
      comando: "detener", solicitadoPor: "u-admin", solicitadoEn: serverTimestamp(),
    }));
  });

  it("solicitadoPor debe ser el usuario que escribe", async () => {
    await assertFails(setDoc(doc(admin(), ruta), orden("otro-uid")));
  });

  it("solicitadoEn debe ser la hora del servidor, no la del cliente", async () => {
    await assertFails(setDoc(doc(admin(), ruta), orden("u-admin", { solicitadoEn: Timestamp.fromMillis(1_000) })));
  });

  it("solicitudId: string de 8 a 64 caracteres", async () => {
    await assertFails(setDoc(doc(admin(), ruta), orden("u-admin", { solicitudId: "corto" })));
    await assertFails(setDoc(doc(admin(), ruta), orden("u-admin", { solicitudId: "x".repeat(65) })));
    await assertFails(setDoc(doc(admin(), ruta), orden("u-admin", { solicitudId: 12345678 })));
  });

  it("lee quien tiene rol; nadie borra", async () => {
    await sembrar(ruta, { comando: "detener" });
    await assertSucceeds(getDoc(doc(visor(), ruta)));
    await assertFails(getDoc(doc(anonimo(), ruta)));
    await assertFails(deleteDoc(doc(admin(), ruta)));
  });
});

describe("simulacionEstado (latido del simulador)", () => {
  it("lee quien tiene rol; nadie escribe desde el cliente", async () => {
    await sembrar("simulacionEstado/cip-sim", { latido: 1, estado: "libre" });
    await assertSucceeds(getDoc(doc(visor(), "simulacionEstado/cip-sim")));
    await assertFails(getDoc(doc(anonimo(), "simulacionEstado/cip-sim")));
    await assertFails(setDoc(doc(admin(), "simulacionEstado/cip-sim"), { latido: 2 }));
    await assertFails(updateDoc(doc(admin(), "simulacionEstado/cip-sim"), { estado: "ejecutando" }));
  });
});
