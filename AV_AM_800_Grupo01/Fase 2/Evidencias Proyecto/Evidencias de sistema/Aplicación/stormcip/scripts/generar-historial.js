// Crea ciclos cerrados de la línea de demo para que los modelos tengan historia.
// Son datos SIMULADOS y quedan marcados (simulado: true, historico: true): no
// demuestran ahorro real, solo muestran cómo se ve el modelo con 40 ciclos.
//
// Cada ciclo varía la velocidad del enjuague y el consumo; 2 de cada 40 son fallas
// donde la conductividad se estanca, como en el escenario "falla" del simulador.
//
// Uso, desde scripts/:
//   node generar-historial.js                                 (emuladores)
//   node generar-historial.js --prod --project <proyecto>     (producción)
// Flags: --ciclos <n> (40), --linea <id> (cip-sim), --dispositivo <id> (wqs-sim-01)
// Los ID son fijos (HIST-001...): correrlo de nuevo reescribe los mismos ciclos.
const path = require("path");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { resolverEntorno, inicializarAdmin, salir } = require("./entorno");

const argv = process.argv.slice(2);
const arg = (n, def) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};
const entorno = resolverEntorno({ flagsConValor: ["ciclos", "linea", "dispositivo"] });
inicializarAdmin(entorno);
const db = getFirestore();

const N = Number(arg("ciclos", 40));
const LINEA = arg("linea", "cip-sim");
const DISPOSITIVO = arg("dispositivo", "wqs-sim-01");
if (!Number.isInteger(N) || N < 1) salir("--ciclos debe ser un entero positivo");

let modelo;
try {
  modelo = require(path.join(__dirname, "..", "functions", "lib", "simulacion", "modeloCip"));
} catch { salir("Falta functions/lib: corre `npm run build` en functions/ antes."); }

const receta = modelo.RECETA_DEFECTO;
const recetaMapa = Object.fromEntries(receta.map((p) => [p.etapa, p.duracionS]));
const EC_RED = 150;
const CADA_S = 3;
const DIA_MS = 86400000;

/** Pseudoaleatorio determinista: mismos ciclos en cada corrida. */
function azar(semilla) {
  let a = semilla * 2654435761 >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function lecturasDeEtapa(etapa, tInicioMs, r, falla) {
  const duracion = recetaMapa[etapa];
  const v = 0.8 + r() * 0.5;                 // velocidad de este enjuague
  const curva = {
    preenjuague: (t) => 300 + 1100 * Math.exp(-t / 12),
    enjuague: (t) => EC_RED + 700 * Math.exp(-t / (8 * v)),
    enjuague_final: falla
      ? (t) => 450 + 142 * Math.exp(-t / 28)
      : (t) => EC_RED + 142 * Math.exp(-t / (24 * v)),
  }[etapa];
  const temp = etapa === "preenjuague" ? 28 : etapa === "enjuague" ? 42 : 30;
  const out = [];
  for (let t = 5; t < duracion; t += CADA_S) {
    const ec25 = +(curva(t) * (1 + (r() - 0.5) * 0.02)).toFixed(1);
    const tempEc = +(temp + (r() - 0.5) * 0.6).toFixed(1);
    out.push({
      v: 2, ts: Timestamp.fromMillis(tInicioMs + t * 1000), etapa, deviceId: DISPOSITIVO,
      valores: {
        conductividad: +(ec25 * (1 + 0.02 * (tempEc - 25))).toFixed(1), tempEc,
        ph: +(7.2 + r() * 0.3).toFixed(2), tempSonda: tempEc,
      },
      derivados: { conductividad25C: ec25 },
      metodo: { conductividad25C: "EC / (1 + 0,02 · (T − 25))" },
      confianza: { conductividad25C: "medido" },
      historico: true,
    });
  }
  return out;
}

(async () => {
  const devSnap = await db.doc(`dispositivos/${DISPOSITIVO}`).get();
  if (!devSnap.exists) salir(`El dispositivo ${DISPOSITIVO} no existe (¿corriste el seed?).`);
  const plantaId = devSnap.get("plantaId");

  for (let i = 0; i < N; i++) {
    const r = azar(i + 1);
    const id = `HIST-${String(i + 1).padStart(3, "0")}`;
    const falla = (i + 1) % 20 === 0;
    // Un ciclo por día hacia atrás, en horario de planta
    const t0 = Date.now() - (N - i) * DIA_MS + Math.floor(r() * 8 * 3600000);
    const cicloRef = db.doc(`ciclos/${id}`);
    await cicloRef.set({
      plantaId, lineaId: LINEA, camion: `SIM-${String((i % 4) + 1).padStart(2, "0")}`,
      programa: `Demo CIP ${modelo.duracionReceta(receta)} s`,
      estado: "en_curso", etapaActual: receta[0].etapa,
      inicio: Timestamp.fromMillis(t0), receta: recetaMapa,
      consumos: { aguaTotal: 0, aguaRecuperada: 0, soda: 0, acido: 0 },
      simulado: true, historico: true, escenario: falla ? "falla" : "normal",
    });

    let batch = db.batch();
    let enBatch = 0;
    let t = t0;
    for (const p of receta) {
      if (["preenjuague", "enjuague", "enjuague_final"].includes(p.etapa)) {
        for (const l of lecturasDeEtapa(p.etapa, t, r, falla)) {
          batch.set(cicloRef.collection("lecturas").doc(`${id}_${l.ts.toMillis()}`), l);
          if (++enBatch === 400) { await batch.commit(); batch = db.batch(); enBatch = 0; }
        }
      }
      t += p.duracionS * 1000;
    }
    if (enBatch) await batch.commit();

    // Pasar a "finalizado" es lo que dispara alCerrarCiclo y, con eso, los modelos
    await cicloRef.update({
      estado: "finalizado", etapaActual: receta[receta.length - 1].etapa,
      fin: Timestamp.fromMillis(t),
      consumos: {
        aguaTotal: +(0.55 + r() * 0.12).toFixed(3), aguaRecuperada: +(0.16 + r() * 0.05).toFixed(3),
        soda: +(140 + r() * 25).toFixed(1), acido: +(130 + r() * 25).toFixed(1),
      },
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    console.log(`${id} ${falla ? "(falla)" : ""}`);
  }
  console.log(`Listo: ${N} ciclos simulados en la línea ${LINEA}.`);
  process.exit(0);
})().catch((e) => salir(e.message));
