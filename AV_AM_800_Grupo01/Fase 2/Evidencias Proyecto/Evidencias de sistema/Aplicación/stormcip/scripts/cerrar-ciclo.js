// Cierra un ciclo: lo pasa a estado "finalizado" y le pone fin.
//
// Eso es lo que dispara alCerrarCiclo (functions/src/ciclos.ts), que calcula
// los indicadores. Mientras el ciclo esté "en_curso" el dashboard muestra las
// tarjetas y la tendencia, pero la sección de indicadores dice "se calculan al
// cerrar el ciclo": no es un error, es que todavía no existe la curva completa.
//
// Uso, desde scripts/:
//   node cerrar-ciclo.js CIP-2026-0001                      (emuladores, por defecto)
//   node cerrar-ciclo.js CIP-2026-0001 --prod --project stormcip-972bd
//
// Producción solo con ambos flags explícitos (mismos guardarraíles que
// simulador-cip.js) y con credenciales de `gcloud auth application-default login`.
// Antes el destino dependía de las variables PROJECT_ID y
// FIRESTORE_EMULATOR_HOST: con PROJECT_ID de producción y sin el host del
// emulador, escribía en producción sin ningún aviso.
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
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
const cicloId = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--project");
if (!cicloId) salir("Falta el id del ciclo. Ej: node cerrar-ciclo.js CIP-2026-0001");

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
  const ref = db.doc(`ciclos/${cicloId}`);
  const snap = await ref.get();

  if (!snap.exists) {
    console.error(`El ciclo ${cicloId} no existe.`);
    process.exit(1);
  }

  const estado = snap.get("estado");
  if (estado === "finalizado") {
    // El trigger solo se dispara en la TRANSICIÓN a finalizado. Para un ciclo
    // ya cerrado, el camino es la bandera de recálculo.
    console.log(`El ciclo ya está finalizado. Para recalcular sus indicadores:`);
    console.log(`  node recalcular.js ${cicloId}${PROD ? ` --prod --project ${PROYECTO_PROD}` : ""}`);
    return;
  }

  const lecturas = await ref.collection("lecturas").count().get();
  const n = lecturas.data().count;
  if (n === 0) {
    console.error(`El ciclo ${cicloId} no tiene lecturas: al cerrarlo los`);
    console.error(`indicadores saldrían vacíos. Carga datos primero:`);
    console.error(`  node simulador-prod.js`);
    process.exit(1);
  }

  await ref.set({
    estado: "finalizado",
    fin: FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(`Ciclo ${cicloId} cerrado (tenía ${n} lecturas).`);
  console.log("alCerrarCiclo calcula los indicadores en unos segundos.");
  if (PROD) console.log(`Verificá con: firebase functions:log --only alCerrarCiclo --project ${PROYECTO_PROD}`);
})();
