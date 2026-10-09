// Rota la API key de un dispositivo: guarda el hash de DEVICE_KEY en
// dispositivos/{id}.apiKeyHash (la key en claro nunca se guarda).
//
// Uso, desde scripts/ (emuladores por defecto):
//   $env:DEVICE_KEY = "<la nueva key>"
//   node rotar-key.js                                         (emuladores, wqs-lb-01)
//   node rotar-key.js --prod --project stormcip-972bd         (producción, wqs-01)
//   $env:DEVICE_ID = "otro-id"                                 para otro dispositivo
//
// Producción solo con ambos flags explícitos y credenciales de
// `gcloud auth application-default login` (guardarraíles en entorno.js). Antes
// el destino dependía de las variables PROJECT_ID y FIRESTORE_EMULATOR_HOST.
const crypto = require("crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { resolverEntorno, inicializarAdmin, salir } = require("./entorno");

const entorno = resolverEntorno();
const { DEVICE_KEY } = process.env;
if (!DEVICE_KEY) salir("Falta DEVICE_KEY.");
// En producción, la misma exigencia que seed-prod.js
if (entorno.prod && (DEVICE_KEY.length < 24 || DEVICE_KEY.startsWith("dev-key"))) {
  salir("DEVICE_KEY demasiado débil para producción.");
}
const id = process.env.DEVICE_ID || (entorno.prod ? "wqs-01" : "wqs-lb-01");

inicializarAdmin(entorno);

(async () => {
  await getFirestore().doc(`dispositivos/${id}`).update({
    apiKeyHash: crypto.createHash("sha256").update(DEVICE_KEY).digest("hex"),
  });
  console.log(`apiKeyHash actualizado en dispositivos/${id}`);
  process.exit(0);
})();
