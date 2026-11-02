// Marca ciclos para que alCerrarCiclo (functions/src/ciclos.ts) recalcule sus
// indicadores. Útil para los ciclos sembrados antes de que el trigger existiera.
//
// Uso, desde scripts/ (emuladores por defecto):
//   node recalcular.js                 -> todos los ciclos finalizados
//   node recalcular.js ID_DEL_CICLO    -> solo ese
//   node recalcular.js [ID] --prod --project stormcip-972bd   -> producción
//
// Producción solo con ambos flags explícitos y credenciales de
// `gcloud auth application-default login` (guardarraíles en entorno.js).
const { getFirestore } = require("firebase-admin/firestore");
const { PROYECTO_PROD, resolverEntorno, inicializarAdmin } = require("./entorno");

const entorno = resolverEntorno();
const PROD = entorno.prod;
inicializarAdmin(entorno);
const db = getFirestore();

(async () => {
  const soloUno = entorno.posicionales[0];

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