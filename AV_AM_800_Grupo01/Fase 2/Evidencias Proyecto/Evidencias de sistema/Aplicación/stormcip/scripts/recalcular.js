// Marca ciclos para que alCerrarCiclo (functions/src/ciclos.ts) recalcule sus
// indicadores. Útil para los ciclos sembrados antes de que el trigger existiera.
//
// Uso, desde scripts/ (emuladores por defecto):
//   node recalcular.js                 -> todos los ciclos finalizados
//   node recalcular.js ID_DEL_CICLO    -> solo ese
//   node recalcular.js [ID] --prod --project stormcip-972bd   -> producción
//
// Producción solo con ambos flags explícitos (mismos guardarraíles que
// cerrar-ciclo.js y simulador-cip.js) y con credenciales de
// `gcloud auth application-default login`. Antes el destino dependía de las
// variables PROJECT_ID y FIRESTORE_EMULATOR_HOST.
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { PROJECT_ID } = require("./config");

const PROYECTO_PROD = "stormcip-972bd";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
};
const salir = (msg) => { console.error(msg); process.exit(1); };

const PROYECTO = arg("project");
const PROD = flag("prod");

// ── Entorno: emuladores por defecto, producción solo explícita ─
let projectId;
if (PROD) {
  if (PROYECTO !== PROYECTO_PROD) salir(`Producción requiere --prod --project ${PROYECTO_PROD} explícitos.`);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    salir("FIRESTORE_EMULATOR_HOST está definido: no se mezcla producción con emuladores.");
  }
  projectId = PROYECTO_PROD;
  initializeApp({ credential: applicationDefault(), projectId });
} else {
  if (PROYECTO) salir("--project solo se usa junto con --prod. Sin --prod se usan los emuladores.");
  // Restos de la forma de uso anterior ($env:PROJECT_ID = "stormcip-972bd")
  if (PROJECT_ID === PROYECTO_PROD) {
    salir(`PROJECT_ID=${PROYECTO_PROD} en el entorno, pero sin --prod se usan los emuladores. ` +
          `Para producción: --prod --project ${PROYECTO_PROD}; para emuladores, borra PROJECT_ID.`);
  }
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  projectId = PROJECT_ID;
  initializeApp({ projectId });
}
console.log(`Entorno: ${PROD ? "PRODUCCIÓN" : `emuladores (${process.env.FIRESTORE_EMULATOR_HOST})`} · proyecto ${projectId}`);
const db = getFirestore();

(async () => {
  const soloUno = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--project");

  const docs = soloUno
    ? [await db.doc(`ciclos/${soloUno}`).get()]
    : (await db.collection("ciclos").where("estado", "==", "finalizado").get()).docs;

  const existentes = docs.filter((d) => d.exists);
  if (existentes.length === 0) {
    console.log("No hay ciclos que recalcular.");
    return;
  }

  // En lotes: Firestore admite 500 escrituras por batch.
  for (let i = 0; i < existentes.length; i += 400) {
    const batch = db.batch();
    for (const d of existentes.slice(i, i + 400)) {
      batch.set(d.ref, { recalcular: true }, { merge: true });
    }
    await batch.commit();
  }

  console.log(`${existentes.length} ciclo(s) marcados. El trigger los procesa en segundos.`);
  if (PROD) console.log(`Verificá con: firebase functions:log --only alCerrarCiclo --project ${PROYECTO_PROD}`);
})();