// Prueba de punta a punta del volumen circulado por etapa (functions/src/volumenCirculado.ts).
// Uso, desde scripts/ (con los emuladores levantados, ver README.md):
//   npm run e2e:volumen                      escenarios A, B y C; borra sus datos al terminar
//   node e2e-volumen.js --simulador          además corre el simulador real (D, ~70 s)
//   node e2e-volumen.js --conservar          deja los datos para mirarlos en la Emulator UI
//   node e2e-volumen.js --limpiar            solo borra los datos de prueba
//
// Escribe estadoProceso/{línea} como lo haría el PLC y comprueba que el trigger
// alCambiarEstadoProceso deja en ciclos/{id}.volumenCirculado lo mismo que una
// integración hecha aquí, por separado, con la regla del trapecio:
//   A. ciclo completo (receta del simulador, tick de 2 s, horas controladas)
//   B. hueco de señal: un intervalo mayor al tope no se suma y se cuenta
//   C. equipo sin caudal: no hay volumenCirculado (el dashboard dice "Sin caudal")
//   D. (--simulador) simulador-cip.js real: las muestras se registran al llegar y
//      el volumen del trigger debe coincidir con integrarlas aquí
//
// Antes: `npm run build` en functions/ (el emulador y este script usan functions/lib).
// Crea y borra sus propios ciclos (CIP-VOL-A/B/C y el de D): no toca los datos del seed.
// Solo emuladores: se niega si el entorno apunta a producción.
const path = require("path");
const assert = require("assert");
const { spawn } = require("child_process");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { PROJECT_ID } = require("./config");
const { PROYECTO_PROD } = require("./entorno");

const salir = (msg) => { console.error(msg); process.exit(1); };
if (PROJECT_ID === PROYECTO_PROD) salir("e2e-volumen.js es solo para emuladores: PROJECT_ID apunta a producción.");
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
if (!/^(127\.0\.0\.1|localhost):/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  salir(`e2e-volumen.js es solo para emuladores y FIRESTORE_EMULATOR_HOST es ${process.env.FIRESTORE_EMULATOR_HOST}.`);
}
const SECRETO = process.env.TTN_WEBHOOK_SECRET || "test-secret";

const lib = (m) => {
  try { return require(path.join(__dirname, "..", "functions", "lib", m)); }
  catch { return salir("Falta functions/lib: corre `npm run build` en functions/ antes."); }
};
const { estadoEn, RECETA_DEFECTO, duracionReceta } = lib("simulacion/modeloCip");
const { CONFIG_VOLUMEN } = lib("volumenCirculado");

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const PRUEBAS = [
  { ciclo: "CIP-VOL-A", linea: "cip-vol-a" },
  { ciclo: "CIP-VOL-B", linea: "cip-vol-b" },
  { ciclo: "CIP-VOL-C", linea: "cip-vol-c" },
];
const LINEA_SIM = "cip-sim", DISPOSITIVO_SIM = "wqs-sim-01";
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const dormirHasta = async (cond, { timeoutMs = 90_000, cadaMs = 400 } = {}) => {
  const fin = Date.now() + timeoutMs;
  while (Date.now() < fin) { if (await cond()) return true; await esperar(cadaMs); }
  return false;
};

// ── Integración independiente (NO usa volumenCirculado.ts): regla del trapecio ──
// Muestra: { cicloId, etapa, estadoCiclo, caudal (m³/h), tsMs }
function esperadoDe(muestras) {
  const litros = {}; let huecos = 0, eventos = 0;
  for (let i = 1; i < muestras.length; i++) {
    const a = muestras[i - 1], b = muestras[i];
    if (a.cicloId !== b.cicloId || a.estadoCiclo !== "en_curso" || a.etapa !== b.etapa) continue;
    const dt = (b.tsMs - a.tsMs) / 1000;
    if (dt <= 0) continue;
    eventos++;
    if (dt > CONFIG_VOLUMEN.huecoMaxS) { huecos++; continue; }
    litros[a.etapa] = (litros[a.etapa] ?? 0) + ((a.caudal + b.caudal) / 2) * (1000 / 3600) * dt;
  }
  return { litros, huecos, eventos };
}

const docEstado = (m, linea, extra = {}) => ({
  v: 1, lineaId: linea, cicloId: m.cicloId, simulado: true, fuente: "e2e-volumen",
  actualizadoEn: Timestamp.fromMillis(m.tsMs), estadoCiclo: m.estadoCiclo, etapa: m.etapa,
  instrumentos: { tempIda: 20, concentracion: 0, caudal: m.caudal, presion: 1 }, ...extra,
});

async function crearCiclo(id, linea) {
  await db.doc(`ciclos/${id}`).set({
    plantaId: "frutillar", lineaId: linea, camion: "TEST", programa: "e2e-volumen",
    estado: "en_curso", etapaActual: "preenjuague", inicio: Timestamp.now(),
  });
}

const marcadores = async (ciclo) => (await db.collection(`ciclos/${ciclo}/eventosVolumen`).get()).size;
const volumenDe = async (ciclo) => (await db.doc(`ciclos/${ciclo}`).get()).data()?.volumenCirculado;

async function esperarEventos(ciclo, n, etiqueta) {
  const ok = await dormirHasta(async () => (await marcadores(ciclo)) >= n);
  assert.ok(ok, `${etiqueta}: el trigger no procesó los ${n} eventos (van ${await marcadores(ciclo)}); ¿emulador de Functions con alCambiarEstadoProceso cargado?`);
  await esperar(500);   // por si llega algún evento de más
}

function comparar(etiqueta, real, esp) {
  const etapas = new Set([...Object.keys(real.litros ?? {}), ...Object.keys(esp.litros)]);
  for (const e of etapas) {
    assert.ok(Math.abs((real.litros?.[e] ?? 0) - (esp.litros[e] ?? 0)) < 1e-6,
      `${etiqueta} ${e}: trigger ${real.litros?.[e]} L ≠ integración independiente ${esp.litros[e]} L`);
  }
  assert.strictEqual(real.huecos, esp.huecos, `${etiqueta}: huecos`);
}

function tabla(real, exactoPorEtapa) {
  console.log("  etapa            trigger (L)   exacto (L)   pérdida");
  let tr = 0, ex = 0;
  for (const [e, ejac] of Object.entries(exactoPorEtapa)) {
    const v = real.litros[e] ?? 0; tr += v; ex += ejac;
    console.log(`  ${e.padEnd(15)} ${v.toFixed(1).padStart(10)} ${ejac.toFixed(1).padStart(12)} ${(((ejac - v) / ejac) * 100).toFixed(2).padStart(8)} %`);
  }
  console.log(`  ${"TOTAL".padEnd(15)} ${tr.toFixed(1).padStart(10)} ${ex.toFixed(1).padStart(12)} ${(((ex - tr) / ex) * 100).toFixed(2).padStart(8)} %`);
}

async function limpiar() {
  for (const p of PRUEBAS) {
    await db.recursiveDelete(db.doc(`ciclos/${p.ciclo}`));
    await db.doc(`estadoProceso/${p.linea}`).delete();
  }
  console.log("Datos de prueba borrados (CIP-VOL-A/B/C y sus líneas).");
}

// ── A. Ciclo completo con la receta del simulador ──
async function escenarioA() {
  const { ciclo, linea } = PRUEBAS[0];
  console.log("\n==================== A. ciclo completo (receta de 300 s, tick de 2 s) ====================");
  await crearCiclo(ciclo, linea);
  const total = duracionReceta(RECETA_DEFECTO), T0 = Date.now() - 3_600_000, TICK = 2;
  const muestraEn = (t, estadoCiclo) => {
    const e = estadoEn(t, RECETA_DEFECTO, "normal").estadoProceso;
    return { cicloId: ciclo, etapa: e.etapa, estadoCiclo, caudal: e.instrumentos.caudal, tsMs: T0 + t * 1000 };
  };
  const muestras = [];
  for (let t = 0; t < total; t += TICK) muestras.push(muestraEn(t, "en_curso"));
  muestras.push(muestraEn(total, "finalizado"));          // cierre: bomba apagada

  const ref = db.doc(`estadoProceso/${linea}`);
  for (const m of muestras) await ref.set(docEstado(m, linea));   // se sobrescribe, como el PLC
  const esp = esperadoDe(muestras);
  console.log(`${muestras.length} escrituras de estadoProceso → ${esp.eventos} intervalos esperados`);

  await esperarEventos(ciclo, esp.eventos, "A");
  const real = await volumenDe(ciclo);
  console.log("\n--- ciclos/CIP-VOL-A.volumenCirculado");
  console.log(JSON.stringify(real, null, 2));
  assert.strictEqual(await marcadores(ciclo), esp.eventos, "A: un marcador por evento, sin repetidos");
  comparar("A", real, esp);
  assert.ok(real.litros.desinfeccion > 0, "A: la desinfección debe tener volumen");
  assert.strictEqual(real.simulado, true);
  const exacto = Object.fromEntries(RECETA_DEFECTO.map((p) => [p.etapa, 5 * (p.duracionS - 2.5)]));
  console.log("\nContra el volumen exacto (18 m³/h = 5 L/s, rampas de 3 s y 2 s):");
  tabla(real, exacto);
  console.log(`✔ A: ${esp.eventos} eventos procesados una vez cada uno; el volumen por etapa coincide con la integración independiente`);
}

// ── B. Hueco de señal ──
async function escenarioB() {
  const { ciclo, linea } = PRUEBAS[1];
  console.log("\n==================== B. hueco de señal (60 s sin muestras) ====================");
  await crearCiclo(ciclo, linea);
  const T0 = Date.now() - 3_600_000;
  const m = (s) => ({ cicloId: ciclo, etapa: "enjuague", estadoCiclo: "en_curso", caudal: 18, tsMs: T0 + s * 1000 });
  const muestras = [m(0), m(2), m(4), m(64), m(66)];
  for (const x of muestras) await db.doc(`estadoProceso/${linea}`).set(docEstado(x, linea));
  const esp = esperadoDe(muestras);
  await esperarEventos(ciclo, esp.eventos, "B");
  const real = await volumenDe(ciclo);
  console.log(JSON.stringify(real, null, 2));
  comparar("B", real, esp);
  assert.strictEqual(real.huecos, 1);
  assert.ok(Math.abs(real.litros.enjuague - 30) < 1e-6, `B: esperaba 30 L (3 intervalos de 10 L), llegó ${real.litros.enjuague}`);
  console.log("✔ B: el intervalo de 60 s no se sumó (se contó como hueco); los otros 3 intervalos suman 30 L");
}

// ── C. Equipo sin caudal ──
async function escenarioC() {
  const { ciclo, linea } = PRUEBAS[2];
  console.log("\n==================== C. equipo sin caudal ====================");
  await crearCiclo(ciclo, linea);
  const T0 = Date.now() - 3_600_000;
  for (let i = 0; i < 5; i++) {
    const m = { cicloId: ciclo, etapa: "enjuague", estadoCiclo: "en_curso", caudal: 0, tsMs: T0 + i * 2000 };
    const d = docEstado(m, linea);
    delete d.instrumentos.caudal;                       // el PLC no informa caudal
    await db.doc(`estadoProceso/${linea}`).set(d);
  }
  await esperar(6000);                                  // tiempo de sobra para que el trigger actúe si fuera a hacerlo
  assert.strictEqual(await volumenDe(ciclo), undefined, "C: no debe haber volumenCirculado sin caudal");
  assert.strictEqual(await marcadores(ciclo), 0, "C: no debe haber marcadores");
  console.log("✔ C: sin caudal no se escribe volumenCirculado ni marcadores (el dashboard muestra 'Sin caudal', no 0 L)");
}

// ── D. Simulador real (hora del servidor, cadencia real) ──
async function escenarioD() {
  console.log("\n==================== D. simulador-cip.js real (60 s) ====================");
  // La línea de la demo puede tener el estado de una simulación anterior: se guarda para
  // dejarlo como estaba, y solo se registran las muestras escritas desde ahora.
  const estadoPrevio = (await db.doc(`estadoProceso/${LINEA_SIM}`).get()).data();
  const inicioMs = Date.now();
  const muestras = [];
  const parar = db.doc(`estadoProceso/${LINEA_SIM}`).onSnapshot((s) => {
    const d = s.data();
    const tsMs = d?.actualizadoEn?.toMillis?.();
    if (!d || tsMs === undefined || tsMs < inicioMs) return;
    const ult = muestras[muestras.length - 1];
    if (ult && ult.tsMs === tsMs && ult.cicloId === d.cicloId) return;
    muestras.push({ cicloId: d.cicloId, etapa: d.etapa, estadoCiclo: d.estadoCiclo, caudal: d.instrumentos?.caudal, tsMs });
  });
  const hijo = spawn(process.execPath, ["simulador-cip.js", "--linea", LINEA_SIM, "--dispositivo", DISPOSITIVO_SIM, "--duracion", "60"],
    { cwd: __dirname, env: { ...process.env, TTN_WEBHOOK_SECRET: SECRETO } });
  let salida = "";
  hijo.stdout.on("data", (b) => { salida += b; }); hijo.stderr.on("data", (b) => { salida += b; });
  const codigo = await new Promise((r) => hijo.on("close", r));
  assert.strictEqual(codigo, 0, `D: simulador-cip.js terminó con código ${codigo}:\n${salida.slice(-600)}`);
  await esperar(1500); parar();

  const ciclos = [...new Set(muestras.map((m) => m.cicloId))];
  const ciclo = ciclos[0];
  try {
    assert.strictEqual(ciclos.length, 1, `D: se esperaba un ciclo nuevo, hubo ${JSON.stringify(ciclos)}`);
    const delCiclo = muestras.filter((m) => m.cicloId === ciclo);
    const esp = esperadoDe(delCiclo);
    console.log(`Ciclo ${ciclo}: ${delCiclo.length} muestras registradas → ${esp.eventos} intervalos esperados`);
    await esperarEventos(ciclo, esp.eventos, "D");
    const real = await volumenDe(ciclo);
    console.log("\n--- volumenCirculado");
    console.log(JSON.stringify(real, null, 2));
    comparar("D", real, esp);
    assert.strictEqual(await marcadores(ciclo), esp.eventos, "D: un marcador por evento");
    const suma = Object.values(real.litros).reduce((a, b) => a + b, 0);
    console.log(`Total ${suma.toFixed(1)} L en ${((delCiclo.at(-1).tsMs - delCiclo[0].tsMs) / 1000).toFixed(0)} s de ciclo real (receta escalada a 60 s)`);
    console.log("✔ D: con la hora del servidor y el simulador real, el trigger coincide con la integración independiente");
  } finally {
    if (!process.argv.includes("--conservar")) {
      for (const id of ciclos) {      // solo ciclos creados por esta ejecución (muestras desde inicioMs)
        await db.recursiveDelete(db.doc(`ciclos/${id}`));
        const alertas = await db.collection("alertas").where("cicloId", "==", id).get();
        await Promise.all(alertas.docs.map((d) => d.ref.delete()));
      }
      // Deja estadoProceso de la línea como estaba antes de la prueba
      if (estadoPrevio) await db.doc(`estadoProceso/${LINEA_SIM}`).set(estadoPrevio);
      else await db.doc(`estadoProceso/${LINEA_SIM}`).delete();
      console.log(`Ciclo ${ciclos.join(", ") || "(ninguno)"} del simulador borrado; estadoProceso/${LINEA_SIM} ${estadoPrevio ? "restaurado" : "borrado (no existía antes)"}.`);
    }
  }
}

(async () => {
  console.log(`Entorno: emuladores · proyecto ${PROJECT_ID} · Firestore ${process.env.FIRESTORE_EMULATOR_HOST}`);
  if (process.argv.includes("--limpiar")) { await limpiar(); return process.exit(0); }
  let fallo = null;
  try {
    await escenarioA(); await escenarioB(); await escenarioC();
    if (process.argv.includes("--simulador")) await escenarioD();
    console.log("\nTodo OK");
  } catch (e) { fallo = e; }
  if (process.argv.includes("--conservar")) console.log("\nDatos conservados (borrarlos: node e2e-volumen.js --limpiar).");
  else await limpiar();
  if (fallo) { console.error("\n✘ FALLÓ:", fallo.message); process.exit(1); }
  process.exit(0);
})();
