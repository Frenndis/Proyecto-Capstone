// Prueba de punta a punta de la concentración química (functions/src/concentracion.ts).
// Uso, desde scripts/ (con los emuladores levantados, ver README.md):
//   npm run e2e:quimica                 prueba y borra los datos de prueba al terminar
//   npm run e2e:quimica -- --conservar  prueba y deja los datos para mirarlos en la Emulator UI
//   npm run e2e:quimica -- --limpiar    solo borra los datos de prueba
//
// Envía lecturas por el flujo real de ingesta (uplink LoRaWAN → ttnUplink → decoder →
// procesarLectura), como en simulador-cip.js, y comprueba que el bloque `quimica` de
// la lectura y de ultimaLectura coincide con calcularQuimica y con el cálculo manual.
// Incluye overrides de configuracion/calculos.concentracion (válido, inválido y mixto).
//
// Antes: `npm run build` en functions/ (el emulador y este script usan functions/lib).
// Crea y borra su propia línea, equipo y ciclo (cip-quimica, wqs-quimica-01,
// CIP-QUIM-TEST): no toca los datos del seed. Restaura configuracion/calculos.
// Solo emuladores: se niega si el entorno apunta a producción.
const path = require("path");
const assert = require("assert");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { PROJECT_ID } = require("./config");
const { PROYECTO_PROD } = require("./entorno");

const salir = (msg) => { console.error(msg); process.exit(1); };
if (PROJECT_ID === PROYECTO_PROD) salir("e2e-quimica.js es solo para emuladores: PROJECT_ID apunta a producción.");
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
if (!/^(127\.0\.0\.1|localhost):/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  salir(`e2e-quimica.js es solo para emuladores y FIRESTORE_EMULATOR_HOST es ${process.env.FIRESTORE_EMULATOR_HOST}.`);
}
const URL_TTN = process.env.TTN_URL ||
  `http://127.0.0.1:5001/${PROJECT_ID}/southamerica-west1/ttnUplink`;
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_TTN)) salir(`TTN_URL no es local: ${URL_TTN}`);
const SECRETO = process.env.TTN_WEBHOOK_SECRET || "test-secret";

const lib = (m) => {
  try { return require(path.join(__dirname, "..", "functions", "lib", m)); }
  catch { return salir("Falta functions/lib: corre `npm run build` en functions/ antes."); }
};
const { encodeWqsFPort2 } = lib("wqsEncoder");
const { calcularQuimica } = lib("concentracion");
const { configConcentracion } = lib("concentracionConfig");

const LINEA = "cip-quimica", DEV = "wqs-quimica-01", DEV_EUI = "5349434950000099", CICLO = "CIP-QUIM-TEST";
const MODELO_EC = "DR-ECK10.0";   // la ECK1.0 comprada satura en 2000 µS/cm: no sirve para una soda válida

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
let segundo = Math.floor(Date.now() / 1000);

const pintar = (titulo, obj) => console.log(`\n--- ${titulo}\n${JSON.stringify(obj, null, 2)}`);

async function preparar() {
  await db.doc(`plantas/frutillar/lineas/${LINEA}`).set({ nombre: "CIP-QUIMICA (prueba e2e)", anden: 0, estado: "activa", simulada: true });
  await db.doc(`dispositivos/${DEV}`).set({
    plantaId: "frutillar", lineaId: LINEA, tipo: "wqs-lb", activo: true, devEui: DEV_EUI,
    apiKeyHash: "x", firmware: "1.2",
    sondas: { s1: { sondaId: "s1", modelo: "DR-PH01", activa: true }, s2: { sondaId: "s2", modelo: MODELO_EC, activa: true } },
  });
  await db.doc(`ciclos/${CICLO}`).set({
    plantaId: "frutillar", lineaId: LINEA, camion: "TEST", programa: "e2e", estado: "en_curso",
    etapaActual: "alcalino", inicio: Timestamp.now(),
  });
}

/** Borra todo lo que crea la prueba y quita el override de configuracion/calculos. */
async function limpiar() {
  await db.recursiveDelete(db.doc(`ciclos/${CICLO}`));        // el ciclo y sus lecturas
  const alertas = await db.collection("alertas").where("cicloId", "==", CICLO).get();
  await Promise.all(alertas.docs.map((d) => d.ref.delete()));
  await db.doc(`dispositivos/${DEV}`).delete();
  await db.doc(`plantas/frutillar/lineas/${LINEA}`).delete();
  if ((await db.doc("configuracion/calculos").get()).exists) {
    await db.doc("configuracion/calculos").update({ concentracion: FieldValue.delete() });
  }
  console.log(`Datos de prueba borrados (${CICLO}, ${DEV}, ${LINEA}).`);
}

async function enviar({ etapa, ec, temp, ph = 13.2, phTemp = temp }) {
  await db.doc(`ciclos/${CICLO}`).update({ etapaActual: etapa });
  const bytes = encodeWqsFPort2({ bateriaV: 3.3, tempExterna: null, ecK10: ec, ecK10Temp: temp, ph, phTemp });
  segundo += 10;   // un received_at distinto por lectura: el id es {devEui}_{segundos}
  const res = await fetch(URL_TTN, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": SECRETO },
    body: JSON.stringify({
      end_device_ids: { device_id: DEV, dev_eui: DEV_EUI },
      uplink_message: { f_port: 2, frm_payload: Buffer.from(bytes).toString("base64") },
      received_at: new Date(segundo * 1000).toISOString(),
    }),
  });
  const cuerpo = await res.json().catch(() => ({}));
  const id = `${DEV_EUI}_${segundo}`;
  const lectura = (await db.doc(`ciclos/${CICLO}/lecturas/${id}`).get()).data();
  const ciclo = (await db.doc(`ciclos/${CICLO}`).get()).data();
  return { http: res.status, cuerpo, id, lectura, ultima: ciclo.ultimaLectura?.[DEV] };
}

// Lo que dicen los tests: calcularQuimica con la misma entrada y la misma configuración
async function esperado(etapa, lectura) {
  const cfgDoc = (await db.doc("configuracion/calculos").get()).data() ?? {};
  const nums = {};
  for (const [k, v] of Object.entries(lectura.valores)) if (typeof v === "number") nums[k] = v;
  return calcularQuimica({
    etapa, valores: nums, confianza: lectura.confianza, modeloSonda: MODELO_EC,
    config: configConcentracion(cfgDoc.concentracion),
  });
}

async function caso(nombre, entrada, manual) {
  const r = await enviar(entrada);
  console.log(`\n==================== ${nombre} ====================`);
  console.log(`POST ttnUplink → HTTP ${r.http} ${JSON.stringify(r.cuerpo)}`);
  assert.ok(r.http === 200 || r.http === 201, `ttnUplink respondió ${r.http}`);
  assert.strictEqual(r.cuerpo.ignorado, undefined, `uplink ignorado: ${r.cuerpo.motivo}`);
  assert.ok(r.lectura, "la lectura no se guardó");
  pintar(`lecturas/${r.id}  (resumen)`, {
    etapa: r.lectura.etapa, valores: r.lectura.valores,
    derivados: r.lectura.derivados, confianza: r.lectura.confianza, quimica: r.lectura.quimica,
  });
  pintar(`ciclos/${CICLO}.ultimaLectura.${DEV}  (resumen)`, {
    ts: r.ultima?.ts?.toDate?.().toISOString(), valores: r.ultima?.valores,
    confianza: r.ultima?.confianza, descartadas: r.ultima?.descartadas, quimica: r.ultima?.quimica,
  });
  const esp = await esperado(entrada.etapa, r.lectura);
  assert.deepStrictEqual(r.lectura.quimica, esp, "quimica de la lectura ≠ calcularQuimica");
  assert.deepStrictEqual(r.ultima.quimica, esp, "quimica de ultimaLectura ≠ calcularQuimica");
  for (const [k, v] of Object.entries(manual ?? {})) {
    assert.deepStrictEqual(r.lectura.quimica[k], v, `quimica.${k}: esperado ${v}, llegó ${r.lectura.quimica[k]}`);
  }
  console.log(`✔ quimica de la lectura y de ultimaLectura coinciden con calcularQuimica y con el cálculo manual`);
}

async function override(nombre, cfg) {
  await db.doc("configuracion/calculos").set({ concentracion: cfg }, { merge: true });
  console.log(`\n>>> configuracion/calculos.concentracion = ${JSON.stringify(cfg)}   [${nombre}]`);
}

async function prueba() {
  await preparar();
  const guardado = (await db.doc("configuracion/calculos").get()).data() ?? {};
  console.log("configuracion/calculos antes de la prueba:", JSON.stringify(guardado));
  // Se parte sin override, con los parámetros por defecto de concentracionConfig.ts
  if ("concentracion" in guardado) await db.doc("configuracion/calculos").update({ concentracion: FieldValue.delete() });

  // κ25 = 14000 / (1 + 0,019·20) = 10 144,9 µS/cm → 10,1449 / 50 = 0,203 %
  await caso("1. ALCALINA válida (EC 14 000 µS/cm, 45 °C)", { etapa: "alcalino", ec: 14000, temp: 45 },
    { fase: "soda", quimico: "NaOH", kappa25: 10144.9, concentracionQuimica: 0.203, confianza: "estimado", motivo: null });
  // 20 000 µS/cm es el tope de la ECK10.0 → saturada
  await caso("2. ALCALINA saturada (EC 20 000 µS/cm = tope de la sonda)", { etapa: "alcalino", ec: 20000, temp: 45 },
    { fase: "soda", kappa25: null, concentracionQuimica: null, confianza: "baja" });
  // κ25 = 9000 / (1 + 0,019·5) = 8 219,2 µS/cm → 0,164 %
  await caso("3. ÁCIDA (EC 9 000 µS/cm, 30 °C)", { etapa: "acido", ec: 9000, temp: 30, ph: 2.1 },
    { fase: "acido", quimico: "acido", kappa25: 8219.2, concentracionQuimica: 0.164, confianza: "estimado", motivo: null });
  await caso("4. ENJUAGUE FINAL (EC 300 µS/cm, 25 °C)", { etapa: "enjuague_final", ec: 300, temp: 25, ph: 7.2 },
    { fase: "agua", quimico: null, kappa25: null, concentracionQuimica: null, confianza: null });
  // κ25 = 3 mS/cm < 5 mS/cm (umbral de agua)
  await caso("5. ALCALINA bajo el umbral de agua (EC 3 000 µS/cm, 25 °C)", { etapa: "alcalino", ec: 3000, temp: 25 },
    { fase: "agua", quimico: "NaOH", kappa25: 3000, concentracionQuimica: null, confianza: null });

  // Override VÁLIDO: m = 25 y la sonda ya compensa → κ25 = EC = 14 000 → 14 / 25 = 0,56 %
  await override("válido: m=25 y sensorYaCompensa DR-ECK10.0=true", { quimicos: { NaOH: { m: 25 } }, sensorYaCompensa: { [MODELO_EC]: true } });
  await caso("6. ALCALINA con override VÁLIDO (misma lectura que el caso 1)", { etapa: "alcalino", ec: 14000, temp: 45 },
    { kappa25: 14000, concentracionQuimica: 0.56, confianza: "estimado" });

  // Override INVÁLIDO: no numérico / no booleano → se ignora y vuelve el cálculo por defecto
  await override("inválido: m='abc', alpha=null, sensorYaCompensa='si'", { quimicos: { NaOH: { m: "abc", alpha: null } }, sensorYaCompensa: { [MODELO_EC]: "si" } });
  await caso("7. ALCALINA con override INVÁLIDO (se ignora → igual que el caso 1)", { etapa: "alcalino", ec: 14000, temp: 45 },
    { kappa25: 10144.9, concentracionQuimica: 0.203, confianza: "estimado" });

  // Override MIXTO: un campo válido y otro inválido en el mismo documento
  await override("mixto: alpha=0.02 (válido) y m='x' (inválido)", { quimicos: { NaOH: { alpha: 0.02, m: "x" } } });
  await caso("8. ALCALINA con override MIXTO (α válido se aplica, m inválido se ignora)", { etapa: "alcalino", ec: 14000, temp: 45 },
    { kappa25: 10000, concentracionQuimica: 0.2 });   // 14000 / (1 + 0,02·20) = 10 000 → 0,2 %

  // configuracion/calculos debe quedar como estaba
  if ("concentracion" in guardado) await db.doc("configuracion/calculos").set(guardado);
  else await db.doc("configuracion/calculos").update({ concentracion: FieldValue.delete() });
  assert.deepStrictEqual((await db.doc("configuracion/calculos").get()).data() ?? {}, guardado,
    "configuracion/calculos no quedó como estaba");
  console.log("\n✔ configuracion/calculos restaurado");
  console.log(`\nTodo OK: ${(await db.collection(`ciclos/${CICLO}/lecturas`).get()).size} lecturas guardadas en ciclos/${CICLO}`);
}

(async () => {
  console.log(`Entorno: emuladores · proyecto ${PROJECT_ID} · Firestore ${process.env.FIRESTORE_EMULATOR_HOST} · uplinks a ${URL_TTN}`);
  if (process.argv.includes("--limpiar")) { await limpiar(); return process.exit(0); }
  let fallo = null;
  try { await prueba(); } catch (e) { fallo = e; }
  if (process.argv.includes("--conservar")) {
    console.log(`\nDatos de prueba conservados (borrarlos: npm run e2e:quimica -- --limpiar).`);
  } else {
    await limpiar();
  }
  if (fallo) { console.error("\n✘ FALLÓ:", fallo.message); process.exit(1); }
  process.exit(0);
})();
