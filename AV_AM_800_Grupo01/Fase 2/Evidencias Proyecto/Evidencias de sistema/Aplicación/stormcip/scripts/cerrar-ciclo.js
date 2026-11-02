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
// Producción solo con ambos flags explícitos y credenciales de
// `gcloud auth application-default login` (guardarraíles en entorno.js).
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { PROYECTO_PROD, resolverEntorno, inicializarAdmin, salir } = require("./entorno");

const entorno = resolverEntorno();
const PROD = entorno.prod;
const cicloId = entorno.posicionales[0];
if (!cicloId) salir("Falta el id del ciclo. Ej: node cerrar-ciclo.js CIP-2026-0001");

inicializarAdmin(entorno);
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
