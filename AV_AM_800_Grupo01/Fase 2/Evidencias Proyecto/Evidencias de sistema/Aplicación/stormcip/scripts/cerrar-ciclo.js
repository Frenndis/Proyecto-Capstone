// Cierra un ciclo: lo pasa a estado "finalizado" y le pone fin.
//
// Eso es lo que dispara alCerrarCiclo (functions/src/ciclos.ts), que calcula
// los indicadores. Mientras el ciclo esté "en_curso" el dashboard muestra las
// tarjetas y la tendencia, pero la sección de indicadores dice "se calculan al
// cerrar el ciclo": no es un error, es que todavía no existe la curva completa.
//
// Requiere, una sola vez:  gcloud auth application-default login
//
// Uso, desde scripts/:
//   $env:PROJECT_ID = "stormcip-972bd"
//   node cerrar-ciclo.js CIP-2026-0001
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const projectId = process.env.PROJECT_ID;
const cicloId = process.argv[2];

if (!projectId) { console.error("Falta PROJECT_ID"); process.exit(1); }
if (!cicloId) {
  console.error("Falta el id del ciclo. Ej: node cerrar-ciclo.js CIP-2026-0001");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
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
    console.log(`  node recalcular.js ${cicloId}`);
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
  console.log("Verificá con: firebase functions:log --only alCerrarCiclo");
})();
