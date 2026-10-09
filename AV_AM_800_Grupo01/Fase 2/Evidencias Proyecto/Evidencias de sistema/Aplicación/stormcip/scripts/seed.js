// Carga datos base en los EMULADORES. Uso: npm run seed
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
const admin = require("firebase-admin");
const crypto = require("crypto");
const { PROJECT_ID } = require("./config");
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

(async () => {
  await db.doc("plantas/frutillar").set({
    nombre: "Planta Frutillar", cliente: "Soprole", proveedor: "Austral Chemicals Chile S.A.",
  });
  await db.doc("plantas/frutillar/lineas/cip-01").set({ nombre: "CIP-01", anden: 2, estado: "activa" });

  // En v2 un dispositivo SIN sondas activas no puede ingestar nada: specDe()
  // no encuentra spec para ninguna variable y procesarLectura responde 400
  // "Sin variables válidas". Por eso cada equipo declara sus sondas.
  //
  // Nota: caudal, presion, concentracion y nivel están en VARIABLES pero ningún
  // modelo de CATALOGO_SONDAS las provee, así que hoy no se pueden ingestar por
  // esta vía. Se deja constancia en vez de inventar un modelo de sonda.
  await db.doc("dispositivos/esp32-01").set({
    plantaId: "frutillar", lineaId: "cip-01", tipo: "esp32", activo: true,
    apiKeyHash: crypto.createHash("sha256").update("dev-key-123").digest("hex"),
    sondas: {
      s1: { sondaId: "s1", modelo: "DR-PH01",   activa: true },
      s2: { sondaId: "s2", modelo: "DR-ECK1.0", activa: true },
    },
  });

  // Unidad WQS-LB con firmware 1.2 (formato B del decoder propio, wqsDecoder.ts) y
  // las sondas del equipo comprado (cotización Altronics COT-2026-1917): DR-PH01
  // y DR-ECK1.0 (0–2000 µS/cm). Sin turbidez (DR-TS1) ni DS18B20 externo.
  //
  // `sondas` es un MAPA, no un array (ver tipo Sonda en functions/src/types.ts), y
  // cada una necesita `activa: true`: specDe() salta toda sonda sin esa bandera.
  await db.doc("dispositivos/wqs-lb-01").set({
    plantaId: "frutillar", lineaId: "cip-01", tipo: "wqs-lb", activo: true,
    apiKeyHash: crypto.createHash("sha256").update("dev-key-wqs-456").digest("hex"),
    firmware: "1.2",
    sondas: {
      s1: { sondaId: "s1", modelo: "DR-PH01",   activa: true },
      s2: { sondaId: "s2", modelo: "DR-ECK1.0", activa: true },
    },
  });

  // Umbrales de PROCESO en variables del modelo v2. Las de v1 (temperatura,
  // caudal, presion, concentracion) no se evalúan: o no existen como variable o
  // ninguna sonda las provee, así que una alerta sobre ellas nunca se dispararía.
  //
  // El indicador real de "agua limpia" es conductividad25C, no la conductividad
  // cruda: sin compensar por temperatura dos lecturas no son comparables.
  //
  // 1500 µS/cm en preenjuague y enjuague: bajo el tope de la DR-ECK1.0 (2000).
  // Supone que la APP compensa la temperatura (la sonda entrega el valor crudo):
  // hasta ~42 °C, una sonda saturada implica EC25 > 1500, así que la alerta de
  // saturación y la de umbral no se contradicen. Si Dragino confirma que la
  // sonda ya compensa, hay que revisar este valor. Sin umbrales de turbidez:
  // el equipo comprado no la mide.
  // ⚠ Provisionales: confirmar con el cliente.
  const enjuagueInicial = {
    ph: { min: 5, max: 11 }, conductividad25C: { max: 1500 },
  };
  const enjuagueLimpio = {
    ph: { min: 6, max: 8.5 }, conductividad25C: { max: 300 },
  };
  await db.doc("configuracion/umbrales").set({
    preenjuague: enjuagueInicial,
    // Etapas químicas: fuera del alcance de monitoreo (las sondas trabajan fuera
    // de su rango físico ahí). Se dejan sin umbrales a propósito.
    enjuague: enjuagueInicial,
    enjuague_final: enjuagueLimpio,
  });

  // Parámetros de los cálculos derivados. Sin este documento se usan los
  // PARAMS_DEFECTO de functions/src/types.ts; se siembra explícito para que el
  // emulador se comporte igual que producción (ver seed-prod.js).
  await db.doc("configuracion/calculos").set({
    factorCompensacionEC: 0.02,
    conductividadAguaRed: 150,
    caudalNominalM3h: 18,
    // Criterio de LIMPIEZA (agua "limpia" para tiempoHastaLimpio), distinto del
    // umbral de ALERTA de enjuague_final (300 µS/cm en configuracion/umbrales):
    // entre ambos el agua es aceptable pero no limpia. El criterio de turbidez
    // queda definido para un equipo con DR-TS1; sin lecturas de turbidez se ignora.
    criterioLimpio: { conductividad25C: 200, turbidez: 10 },
  });

  await db.doc("ciclos/CIP-2026-0001").set({
    plantaId: "frutillar", lineaId: "cip-01", camion: "LSGB-73",
    programa: "Estanque leche estándar", estado: "en_curso", etapaActual: "preenjuague",
    inicio: admin.firestore.Timestamp.now(),
    consumos: { aguaTotal: 0, aguaRecuperada: 0, soda: 0, acido: 0 },
  });

  let user;
  try {
    user = await admin.auth().createUser({ email: "admin@stormcip.dev", password: "admin123", displayName: "Admin" });
  } catch { user = await admin.auth().getUserByEmail("admin@stormcip.dev"); }
  await admin.auth().setCustomUserClaims(user.uid, { rol: "admin" });
  await db.doc(`users/${user.uid}`).set({ email: user.email, nombre: "Admin", rol: "admin" });

  console.log("Seed OK -> admin@stormcip.dev / admin123 | esp32-01/dev-key-123 | wqs-lb-01/dev-key-wqs-456");
  process.exit(0);
})();
