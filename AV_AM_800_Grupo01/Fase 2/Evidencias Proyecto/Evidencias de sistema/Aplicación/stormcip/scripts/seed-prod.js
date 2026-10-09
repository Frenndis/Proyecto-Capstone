// Siembra datos base en PRODUCCIÓN. A diferencia de seed.js, no trae ninguna
// credencial escrita: las exige por variable de entorno y se niega a correr sin
// ellas, para que `dev-key-123` nunca llegue a una base pública.
//
// Uso (PowerShell, desde scripts\):
//   $env:ADMIN_EMAIL = "admin@tudominio.cl"
//   $env:ADMIN_PASS  = "<la que generaste>"
//   $env:DEVICE_KEY  = "<la que generaste>"
//   node seed-prod.js --project stormcip-972bd --confirmar
//
// Guardarraíles (como produccion-plantilla.js): el proyecto va SOLO como flag
// explícito, se exige --confirmar y hay 5 s para cancelar. Antes el destino
// salía de la variable PROJECT_ID, que podía quedar definida de otra tarea.
const admin = require("firebase-admin");
const crypto = require("crypto");
const { PROYECTO_PROD } = require("./entorno");

const args = process.argv.slice(2);
const iProyecto = args.indexOf("--project");
const PROJECT_ID = iProyecto > -1 ? args[iProyecto + 1] : undefined;
if (PROJECT_ID !== PROYECTO_PROD) {
  console.error(`Falta --project ${PROYECTO_PROD}. Este script no tiene un proyecto por defecto (a propósito).`);
  process.exit(1);
}
if (!args.includes("--confirmar")) {
  console.error("Falta --confirmar. Revisa los datos del script antes de agregar esta bandera.");
  process.exit(1);
}

// Guardarraíl: si quedó apuntando a los emuladores, no es producción.
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Hay variables de emulador definidas. Para sembrar producción, abre una terminal limpia.");
  process.exit(1);
}

const { ADMIN_EMAIL, ADMIN_PASS, DEVICE_KEY } = process.env;
const faltan = Object.entries({ ADMIN_EMAIL, ADMIN_PASS, DEVICE_KEY })
  .filter(([, v]) => !v).map(([k]) => k);
if (faltan.length) {
  console.error("Faltan variables de entorno:", faltan.join(", "));
  process.exit(1);
}
if (ADMIN_PASS.length < 12 || /^admin|123/.test(ADMIN_PASS)) {
  console.error("ADMIN_PASS demasiado débil. Usa la que generaste con crypto.randomBytes.");
  process.exit(1);
}
if (DEVICE_KEY.length < 24 || DEVICE_KEY.startsWith("dev-key")) {
  console.error("DEVICE_KEY demasiado débil. Usa la que generaste con crypto.randomBytes.");
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

(async () => {
  console.log(`Esto va a escribir en el proyecto: ${PROJECT_ID}`);
  console.log("Ctrl+C ahora si no es el proyecto correcto. Continuando en 5 segundos...");
  await new Promise((r) => setTimeout(r, 5000));

  await db.doc("plantas/demo").set({ nombre: "Planta Demo", cliente: "Cliente Demo" });
  await db.doc("plantas/demo/lineas/cip-01").set({
    nombre: "CIP-01", anden: 1, estado: "activa", caudalNominalM3h: 18,
  });

  // El hash es lo único que se guarda: la key en claro no se puede recuperar
  await db.doc("dispositivos/wqs-01").set({
    plantaId: "demo", lineaId: "cip-01", tipo: "wqs-lb", activo: true,
    devEui: "0000000000000001",
    firmware: "1.2",
    apiKeyHash: crypto.createHash("sha256").update(DEVICE_KEY).digest("hex"),
    // Equipo comprado: DR-PH01 + DR-ECK1.0 (0–2000 µS/cm), sin turbidez ni DS18B20
    sondas: {
      s1: { sondaId: "s1", modelo: "DR-PH01",   activa: true },
      s2: { sondaId: "s2", modelo: "DR-ECK1.0", activa: true },
    },
  });

  // Umbrales de PROCESO, solo etapas de enjuague (alcance real del hardware).
  // 1500 µS/cm: bajo el tope de la DR-ECK1.0 y suponiendo que la app compensa la
  // temperatura (ver seed.js). Sin turbidez: el equipo no la mide.
  // ⚠ Provisionales: confirmar con el cliente.
  const enjuagueInicial = {
    ph: { min: 5, max: 11 }, conductividad25C: { max: 1500 },
  };
  const enjuagueLimpio = {
    ph: { min: 6, max: 8.5 }, conductividad25C: { max: 300 },
  };
  await db.doc("configuracion/umbrales").set({
    preenjuague: enjuagueInicial,
    enjuague: enjuagueInicial,
    enjuague_final: enjuagueLimpio,
  });

  await db.doc("configuracion/calculos").set({
    factorCompensacionEC: 0.02,
    conductividadAguaRed: 150,
    caudalNominalM3h: 18,
    // Criterio de LIMPIEZA (agua "limpia" para tiempoHastaLimpio), distinto del
    // umbral de ALERTA de enjuague_final (300 µS/cm en configuracion/umbrales):
    // entre ambos el agua es aceptable pero no limpia. Sin turbidez se ignora
    // su criterio.
    criterioLimpio: { conductividad25C: 200, turbidez: 10 },
  });

  await db.doc("ciclos/CIP-2026-0001").set({
    plantaId: "demo", lineaId: "cip-01", camion: "DEMO-01",
    programa: "Enjuague estándar", estado: "en_curso", etapaActual: "enjuague",
    inicio: admin.firestore.Timestamp.now(),
    consumos: { aguaTotal: 0, aguaRecuperada: 0, soda: 0, acido: 0 },
  });

  let user;
  try {
    user = await admin.auth().createUser({
      email: ADMIN_EMAIL, password: ADMIN_PASS, displayName: "Admin",
    });
  } catch {
    user = await admin.auth().getUserByEmail(ADMIN_EMAIL);
    await admin.auth().updateUser(user.uid, { password: ADMIN_PASS });
  }
  // El rol vive en custom claims, que es lo que leen las reglas de Firestore
  await admin.auth().setCustomUserClaims(user.uid, { rol: "admin" });
  await db.doc(`users/${user.uid}`).set({
    email: user.email, nombre: "Admin", rol: "admin", plantaIds: ["demo"],
  });

  console.log(`Seed de producción OK en ${PROJECT_ID}`);
  console.log(`Admin: ${ADMIN_EMAIL} · dispositivo: wqs-01`);
  console.log("La API key no queda guardada en claro: consérvala donde la anotaste.");
  process.exit(0);
})();
