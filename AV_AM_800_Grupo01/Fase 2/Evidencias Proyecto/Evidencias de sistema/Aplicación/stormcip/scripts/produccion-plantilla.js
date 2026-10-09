// Plantilla para cargar datos REALES en Firestore (no datos de prueba).
// A diferencia de seed.js, este script:
//  - No tiene ningún proyecto por defecto: exige --project explícito.
//  - Exige --confirmar explícito.
//  - Se niega a correr si queda algún "<COMPLETAR>" sin reemplazar más abajo.
// Aun así, no se corre a la ligera: revisar DATOS con cuidado antes de usar.
//
// Uso (después de completar los valores de abajo):
//   node produccion-plantilla.js --project stormcip-972bd --confirmar

const admin = require("firebase-admin");

// ---------- COMPLETAR ANTES DE USAR ----------
const DATOS = {
  planta: {
    id: "<COMPLETAR>", // ej. "frutillar"
    nombre: "<COMPLETAR>",
    cliente: "<COMPLETAR>",
    proveedor: "<COMPLETAR>",
  },
  linea: {
    id: "<COMPLETAR>", // ej. "cip-01"
    nombre: "<COMPLETAR>",
    anden: "<COMPLETAR>",
  },
  dispositivo: {
    id: "<COMPLETAR>", // deviceId: debe ser igual al "Device ID" registrado en TTS
    devEui: "<COMPLETAR>", // DevEUI real del equipo (solo informativo; ttnUplink no lo valida hoy)
    firmware: "<COMPLETAR>", // ej. "1.2" — confirmar con el uplink de estado (FPort=5) real, no adivinar
    sondas: [
      // Completar según lo que esté físicamente conectado en este equipo.
      // Modelos válidos: ver CATALOGO_SONDAS en functions/src/types.ts.
      // Equipo comprado (cotización COT-2026-1917): DR-PH01 + DR-ECK1.0, sin
      // turbidez (DR-TS1) ni DS18B20. Descomentar si coincide con lo instalado:
      // { modelo: "DR-PH01" },
      // { modelo: "DR-ECK1.0" },
    ],
  },
  ciclo: {
    id: "<COMPLETAR>",
    camion: "<COMPLETAR>",
    programa: "<COMPLETAR>",
    etapaInicial: "<COMPLETAR>", // una de ETAPAS en functions/src/types.ts
  },
  // Umbrales de proceso reales por etapa, acordados con el cliente —
  // no copiar los de scripts/seed.js, esos son de ejemplo. Con la DR-ECK1.0
  // ningún umbral de conductividad puede superar su tope (2000 µS/cm).
  umbrales: {
    // preenjuague: { caudal: { min: <COMPLETAR> }, presion: { min: <COMPLETAR>, max: <COMPLETAR> } },
  },
};
// ---------- FIN COMPLETAR ----------

function buscarPendientes(obj, ruta = "") {
  const pendientes = [];
  for (const [k, v] of Object.entries(obj)) {
    const rutaActual = ruta ? `${ruta}.${k}` : k;
    if (v === "<COMPLETAR>") pendientes.push(rutaActual);
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      pendientes.push(...buscarPendientes(v, rutaActual));
    }
  }
  return pendientes;
}

(async () => {
  const args = process.argv.slice(2);
  const projectIdx = args.indexOf("--project");
  const projectId = projectIdx !== -1 ? args[projectIdx + 1] : null;
  const confirmar = args.includes("--confirmar");

  if (!projectId) {
    console.error("Falta --project <id>. Este script no tiene un proyecto por defecto (a propósito).");
    process.exit(1);
  }
  if (!confirmar) {
    console.error("Falta --confirmar. Revisa DATOS con cuidado antes de agregar esta bandera.");
    process.exit(1);
  }

  const pendientes = buscarPendientes(DATOS);
  if (pendientes.length > 0) {
    console.error("Quedan valores <COMPLETAR> sin llenar:");
    for (const p of pendientes) console.error(` - ${p}`);
    process.exit(1);
  }
  if (DATOS.dispositivo.sondas.length === 0) {
    console.error("dispositivo.sondas está vacío — completar con las sondas realmente conectadas.");
    process.exit(1);
  }

  console.log(`Esto va a escribir en el proyecto: ${projectId}`);
  console.log("Ctrl+C ahora si no es el proyecto correcto. Continuando en 5 segundos...");
  await new Promise((r) => setTimeout(r, 5000));

  admin.initializeApp({ projectId });
  const db = admin.firestore();

  await db.doc(`plantas/${DATOS.planta.id}`).set({
    nombre: DATOS.planta.nombre,
    cliente: DATOS.planta.cliente,
    proveedor: DATOS.planta.proveedor,
  });

  await db.doc(`plantas/${DATOS.planta.id}/lineas/${DATOS.linea.id}`).set({
    nombre: DATOS.linea.nombre,
    anden: DATOS.linea.anden,
    estado: "activa",
  });

  await db.doc(`dispositivos/${DATOS.dispositivo.id}`).set({
    plantaId: DATOS.planta.id,
    lineaId: DATOS.linea.id,
    tipo: "wqs-lb",
    activo: true,
    devEui: DATOS.dispositivo.devEui,
    firmware: DATOS.dispositivo.firmware,
    sondas: DATOS.dispositivo.sondas,
    // Sin apiKeyHash: este dispositivo entra por ttnUplink (webhook de TTS),
    // no por /api/ingest, así que no necesita API key.
  });

  await db.doc(`ciclos/${DATOS.ciclo.id}`).set({
    plantaId: DATOS.planta.id,
    lineaId: DATOS.linea.id,
    camion: DATOS.ciclo.camion,
    programa: DATOS.ciclo.programa,
    estado: "en_curso",
    etapaActual: DATOS.ciclo.etapaInicial,
    inicio: admin.firestore.Timestamp.now(),
    consumos: { aguaTotal: 0, aguaRecuperada: 0, soda: 0, acido: 0 },
  });

  await db.doc("configuracion/umbrales").set(DATOS.umbrales, { merge: true });

  console.log("Listo. Revisar en la consola de Firestore del proyecto real.");
  process.exit(0);
})();
