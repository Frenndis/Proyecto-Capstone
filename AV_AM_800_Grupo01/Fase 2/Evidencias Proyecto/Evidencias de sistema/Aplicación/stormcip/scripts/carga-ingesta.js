// Prueba de carga de la ingesta (RNF-07): envía muchas lecturas seguidas a
// ingestLectura y comprueba que ninguna se pierde. Mide la latencia de cada envío.
//
// Solo emuladores. Requiere `npm run seed` antes (usa el dispositivo esp32-01 y el
// ciclo CIP-2026-0001 que deja el seed). Los tiempos del emulador NO representan
// a producción: la prueba demuestra que no se pierden ni duplican lecturas bajo
// envío concurrente, no el rendimiento de la nube.
//
// Uso, desde scripts/:
//   node carga-ingesta.js                       300 lecturas, 10 en paralelo
//   node carga-ingesta.js --lecturas 1000 --paralelo 25
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { PROJECT_ID } = require("./config");
const { PROYECTO_PROD } = require("./entorno");

const URL = `http://127.0.0.1:5001/${PROJECT_ID}/southamerica-west1/ingestLectura`;
if (PROJECT_ID === PROYECTO_PROD) { console.error("carga-ingesta.js es solo para emuladores."); process.exit(1); }
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

const arg = (n, def) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? Number(process.argv[i + 1]) : def; };
const TOTAL = arg("lecturas", 300), PARALELO = arg("paralelo", 10);
const DEVICE_ID = "esp32-01", API_KEY = "dev-key-123", CICLO_ID = "CIP-2026-0001";

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const pct = (orden, p) => orden[Math.min(orden.length - 1, Math.floor(orden.length * p))];

(async () => {
  const lecturas = db.collection(`ciclos/${CICLO_ID}/lecturas`);
  // Cada lectura lleva su propio segundo, en una ventana pasada que solo usa esta prueba
  const baseMs = Date.UTC(2020, 0, 1) + Math.floor(Math.random() * 1e6) * 100000;
  const enVentana = () => lecturas.where("ts", ">=", Timestamp.fromMillis(baseMs)).where("ts", "<", Timestamp.fromMillis(baseMs + TOTAL * 1000)).get();

  console.log(`Carga: ${TOTAL} lecturas, ${PARALELO} en paralelo → ${URL}`);
  const latencias = [], errores = {};
  let siguiente = 0;
  const t0 = Date.now();
  async function trabajador() {
    while (siguiente < TOTAL) {
      const i = siguiente++;
      const inicio = Date.now();
      try {
        const res = await fetch(URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
          body: JSON.stringify({
            deviceId: DEVICE_ID, cicloId: CICLO_ID, ts: baseMs + i * 1000,
            valores: { conductividad: 400 + (i % 50), tempEc: 30 + (i % 5), ph: 7.5, turbidez: 5 },
          }),
        });
        if (res.status === 201) latencias.push(Date.now() - inicio);
        else errores[res.status] = (errores[res.status] ?? 0) + 1;
      } catch (e) { errores[e.code ?? "red"] = (errores[e.code ?? "red"] ?? 0) + 1; }
    }
  }
  await Promise.all(Array.from({ length: PARALELO }, trabajador));
  const duracionS = (Date.now() - t0) / 1000;

  const guardadas = (await enVentana()).size;
  const orden = [...latencias].sort((a, b) => a - b);
  console.log(`Aceptadas (201): ${latencias.length} de ${TOTAL} · errores: ${JSON.stringify(errores)}`);
  console.log(`Guardadas en Firestore: ${guardadas} de ${TOTAL} · perdidas: ${TOTAL - guardadas}`);
  console.log(`Duración: ${duracionS.toFixed(1)} s · ${(TOTAL / duracionS).toFixed(1)} lecturas/s`);
  if (orden.length) console.log(`Latencia por envío: p50 ${pct(orden, 0.5)} ms · p95 ${pct(orden, 0.95)} ms · máx ${orden[orden.length - 1]} ms`);

  // Reenvío de la primera lectura. Informativo: ingestLectura (endpoint legado de simuladores)
  // no arma un id determinista, así que un reenvío crea otro documento. La idempotencia
  // está en ttnUplink, el camino del sensor real (caso 5 de `npm run sim:ttn`).
  await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ deviceId: DEVICE_ID, cicloId: CICLO_ID, ts: baseMs, valores: { conductividad: 400, tempEc: 30, ph: 7.5, turbidez: 5 } }) });
  const trasReenvio = (await enVentana()).size;
  console.log(`Informativo · tras reenviar una lectura ya enviada: ${trasReenvio} documentos (${trasReenvio === guardadas ? "no duplicó" : "ingestLectura duplicó: limitación conocida, ver plan de pruebas"})`);

  // Limpieza de las lecturas de la prueba
  const snap = await enVentana();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const lote = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => lote.delete(d.ref));
    await lote.commit();
  }
  console.log(`Lecturas de la prueba borradas (${snap.size}).`);

  const ok = guardadas === TOTAL && latencias.length === TOTAL;
  console.log(ok ? "Todo OK" : "FALLA: se perdieron o rechazaron lecturas");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
