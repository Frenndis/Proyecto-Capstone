// Carga datos base en los EMULADORES. Uso: npm run seed
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
const admin = require("firebase-admin");
const crypto = require("crypto");
admin.initializeApp({ projectId: process.env.PROJECT_ID || "stormcip-dev" });
const db = admin.firestore();

(async () => {
  await db.doc("plantas/frutillar").set({
    nombre: "Planta Frutillar", cliente: "Soprole", proveedor: "Austral Chemicals Chile S.A.",
  });
  await db.doc("plantas/frutillar/lineas/cip-01").set({ nombre: "CIP-01", anden: 2, estado: "activa" });

  await db.doc("dispositivos/esp32-01").set({
    plantaId: "frutillar", lineaId: "cip-01", tipo: "esp32", activo: true,
    apiKeyHash: crypto.createHash("sha256").update("dev-key-123").digest("hex"),
  });

  // Rangos tomados de la presentación (ácido ±5 °C es supuesto, validar con cliente)
  const enjuague = { caudal: { min: 16 }, presion: { min: 2, max: 3 } };
  await db.doc("configuracion/umbrales").set({
    preenjuague: enjuague,
    alcalino: {
      temperatura: { min: 75, max: 80 }, concentracion: { min: 1, max: 2 },
      caudal: { min: 16 }, presion: { min: 2, max: 3 }, ph: { min: 11.5 }, turbidez: { max: 40 },
    },
    enjuague,
    acido: {
      temperatura: { min: 55, max: 65 }, concentracion: { min: 0.5, max: 1 },
      caudal: { min: 16 }, presion: { min: 2, max: 3 },
    },
    enjuague_final: enjuague,
    desinfeccion: enjuague,
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

  console.log("Seed OK -> admin@stormcip.dev / admin123 | device esp32-01 / dev-key-123");
  process.exit(0);
})();
