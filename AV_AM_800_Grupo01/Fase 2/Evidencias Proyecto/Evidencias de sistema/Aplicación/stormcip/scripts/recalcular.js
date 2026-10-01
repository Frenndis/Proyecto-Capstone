// Marca ciclos para que alCerrarCiclo (functions/src/ciclos.ts) recalcule sus
// indicadores. Útil para los ciclos sembrados antes de que el trigger existiera.
//
// Requiere, una sola vez:  gcloud auth application-default login
//
// Uso, desde scripts/:
//   $env:PROJECT_ID = "stormcip-972bd"
//   node recalcular.js                 -> todos los ciclos finalizados
//   node recalcular.js ID_DEL_CICLO    -> solo ese
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const projectId = process.env.PROJECT_ID;
if (!projectId) {
  console.error("Falta PROJECT_ID");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

(async () => {
  const soloUno = process.argv[2];

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
  console.log("Verificá con: firebase functions:log --only alCerrarCiclo");
})();