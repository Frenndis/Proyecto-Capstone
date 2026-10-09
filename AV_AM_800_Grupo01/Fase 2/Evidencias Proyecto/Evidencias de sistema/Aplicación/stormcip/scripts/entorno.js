// Guardarraíles de entorno compartidos por los scripts que pueden escribir en
// producción (cerrar-ciclo.js, recalcular.js, rotar-key.js, simulador-prod.js).
//
// Regla (ver DESPLIEGUE.md): ningún script toca producción sin flags explícitos.
//  - Sin flags: emuladores.
//  - Producción: solo con `--prod --project stormcip-972bd`, sin variables de
//    emulador definidas y con credenciales de `gcloud auth application-default login`.
//  - Un PROJECT_ID de producción en el entorno sin --prod se rechaza (restos de
//    la forma de uso anterior, `$env:PROJECT_ID = "stormcip-972bd"`).
const { PROJECT_ID } = require("./config");

const PROYECTO_PROD = "stormcip-972bd";

const salir = (msg) => { console.error(msg); process.exit(1); };

/**
 * Lee --prod y --project de la línea de comandos y decide el destino.
 * `flagsConValor`: otros flags del script que llevan valor (p. ej. "pasos"),
 * para no confundir ese valor con un argumento posicional.
 */
function resolverEntorno({ flagsConValor = [] } = {}) {
  const argv = process.argv.slice(2);
  const conValor = new Set(["project", ...flagsConValor]);
  const valor = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i > -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
  };
  const posicionales = argv.filter((a, i) =>
    !a.startsWith("--") && !(i > 0 && conValor.has(argv[i - 1].replace(/^--/, ""))));
  const prod = argv.includes("--prod");
  const proyecto = valor("project");

  if (prod) {
    if (proyecto !== PROYECTO_PROD) salir(`Producción requiere --prod --project ${PROYECTO_PROD} explícitos.`);
    if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      salir("Hay variables de emulador definidas: no se mezcla producción con emuladores.");
    }
    return { prod: true, projectId: PROYECTO_PROD, posicionales, valor };
  }
  if (proyecto) salir("--project solo se usa junto con --prod. Sin --prod se usan los emuladores.");
  if (PROJECT_ID === PROYECTO_PROD) {
    salir(`PROJECT_ID=${PROYECTO_PROD} en el entorno, pero sin --prod se usan los emuladores. ` +
          `Para producción: --prod --project ${PROYECTO_PROD}; para emuladores, borra PROJECT_ID.`);
  }
  return { prod: false, projectId: PROJECT_ID, posicionales, valor };
}

/** Inicializa Admin SDK en el destino resuelto y lo anuncia. */
function inicializarAdmin(entorno) {
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  if (entorno.prod) {
    initializeApp({ credential: applicationDefault(), projectId: entorno.projectId });
  } else {
    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
    initializeApp({ projectId: entorno.projectId });
  }
  anunciar(entorno, entorno.prod ? "" : `Firestore ${process.env.FIRESTORE_EMULATOR_HOST}`);
}

function anunciar(entorno, detalle = "") {
  console.log(`Entorno: ${entorno.prod ? "PRODUCCIÓN" : "emuladores"} · proyecto ${entorno.projectId}` +
              (detalle ? ` · ${detalle}` : ""));
}

module.exports = { PROYECTO_PROD, resolverEntorno, inicializarAdmin, anunciar, salir };
