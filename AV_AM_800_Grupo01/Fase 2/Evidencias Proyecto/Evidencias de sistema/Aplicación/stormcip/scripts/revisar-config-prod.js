// Revisa (SOLO LECTURA) que la configuración de Firestore coincida con la que
// espera el código antes de desplegar: configuracion/umbrales,
// configuracion/calculos y dispositivos/*. No escribe nada y no lee apiKeyHash
// (select() hace que el servidor no la envíe).
//
// Uso, desde scripts/:
//   node revisar-config-prod.js                                   (emuladores)
//   node revisar-config-prod.js --prod --project stormcip-972bd   (producción)
//
// Producción solo con ambos flags explícitos y credenciales de
// `gcloud auth application-default login` (guardarraíles en entorno.js).
// Los valores esperados son los de seed-prod.js: si cambian allí, cambian aquí.
const { getFirestore } = require("firebase-admin/firestore");
const { resolverEntorno, inicializarAdmin } = require("./entorno");

// ── Lo que espera el código ──────────────────────────────────
const ENJUAGUE_INICIAL = { ph: { min: 5, max: 11 }, conductividad25C: { max: 1500 } };
const ENJUAGUE_LIMPIO = { ph: { min: 6, max: 8.5 }, conductividad25C: { max: 300 } };
const UMBRALES_ESPERADOS = {
  preenjuague: ENJUAGUE_INICIAL, enjuague: ENJUAGUE_INICIAL, enjuague_final: ENJUAGUE_LIMPIO,
};
const CALCULOS_ESPERADOS = {
  factorCompensacionEC: 0.02, conductividadAguaRed: 150, caudalNominalM3h: 18,
  criterioLimpio: { conductividad25C: 200, turbidez: 10 },
};
const SONDAS_ESPERADAS = ["DR-PH01", "DR-ECK1.0"];

// ── Comparación (pura, sin Firestore) ────────────────────────
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ruta = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

/** Compara un documento con lo esperado, clave a clave. Devuelve líneas {ok, texto}. */
function compararDoc(nombre, actual, esperado, rutas) {
  if (!actual) return [{ ok: false, texto: `${nombre}: NO EXISTE. Crearlo con ${JSON.stringify(esperado)}` }];
  return rutas.map((r) => {
    const a = ruta(actual, r), e = ruta(esperado, r);
    return igual(a, e)
      ? { ok: true, texto: `${nombre}.${r} = ${JSON.stringify(e)}` }
      : { ok: false, texto: `${nombre}.${r}: hoy ${a === undefined ? "(no existe)" : JSON.stringify(a)}, debe ser ${JSON.stringify(e)}` };
  });
}

function compararUmbrales(actual) {
  const rutas = [];
  for (const [etapa, vars] of Object.entries(UMBRALES_ESPERADOS)) {
    for (const [v, r] of Object.entries(vars)) {
      for (const lim of Object.keys(r)) rutas.push(`${etapa}.${v}.${lim}`);
    }
  }
  const out = compararDoc("umbrales", actual, UMBRALES_ESPERADOS, rutas);
  // Claves que el código ya no usa: solo se informan (no es un cambio obligatorio)
  const extra = [];
  for (const [etapa, vars] of Object.entries(actual ?? {})) {
    for (const v of Object.keys(vars ?? {})) {
      if (!(etapa in UMBRALES_ESPERADOS) || !(v in UMBRALES_ESPERADOS[etapa])) extra.push(`${etapa}.${v}`);
    }
  }
  if (extra.length) {
    out.push({ ok: true, info: true, texto: `umbrales: claves adicionales que el código seguirá evaluando si existen: ${extra.join(", ")}` });
  }
  return out;
}

function compararCalculos(actual) {
  return compararDoc("calculos", actual, CALCULOS_ESPERADOS, [
    "factorCompensacionEC", "conductividadAguaRed", "caudalNominalM3h",
    "criterioLimpio.conductividad25C", "criterioLimpio.turbidez",
  ]);
}

function compararDispositivo(id, d) {
  const out = [];
  const linea = (ok, texto) => out.push({ ok, texto: `dispositivos/${id}: ${texto}` });
  linea(d.activo === true, d.activo === true ? "activo" : `activo = ${JSON.stringify(d.activo)}, debe ser true`);
  linea(typeof d.lineaId === "string" && d.lineaId !== "",
    d.lineaId ? `lineaId = ${d.lineaId}` : "sin lineaId (ttnUplink no encuentra el ciclo en curso)");
  // Firmware y sondas solo importan en equipos LoRaWAN (el decoder elige el formato por firmware)
  if (d.tipo !== "wqs-lb") {
    out.push({ ok: true, info: true, texto: `dispositivos/${id}: tipo ${JSON.stringify(d.tipo)}, no es wqs-lb: no se revisan firmware ni sondas` });
    return out;
  }
  linea(typeof d.firmware === "string" && /^\d+\.\d+/.test(d.firmware),
    /^\d+\.\d+/.test(d.firmware ?? "") ? `firmware = ${d.firmware}` : `firmware = ${JSON.stringify(d.firmware)}: debe ser una versión (ej. "1.2")`);
  const activas = Object.values(d.sondas ?? {}).filter((s) => s && s.activa).map((s) => s.modelo).sort();
  const esperadas = [...SONDAS_ESPERADAS].sort();
  linea(igual(activas, esperadas),
    igual(activas, esperadas) ? `sondas activas = ${activas.join(" + ")}`
      : `sondas activas hoy: ${activas.length ? activas.join(" + ") : "(ninguna)"}; deben ser ${esperadas.join(" + ")}`);
  if (!d.devEui) {
    out.push({ ok: true, info: true, texto: `dispositivos/${id}: sin devEui (ttnUplink usa el dev_eui del mensaje; solo informativo)` });
  }
  return out;
}

// ── Lectura ──────────────────────────────────────────────────
async function main() {
  const entorno = resolverEntorno();
  inicializarAdmin(entorno);
  const db = getFirestore();
  const resultados = [];

  const [um, ca] = await Promise.all([db.doc("configuracion/umbrales").get(), db.doc("configuracion/calculos").get()]);
  resultados.push(...compararUmbrales(um.exists ? um.data() : undefined));
  resultados.push(...compararCalculos(ca.exists ? ca.data() : undefined));

  const devs = await db.collection("dispositivos")
    .select("lineaId", "tipo", "activo", "devEui", "firmware", "sondas").get();
  if (devs.empty) resultados.push({ ok: false, texto: "dispositivos: no hay ninguno" });
  devs.forEach((x) => resultados.push(...compararDispositivo(x.id, x.data())));

  console.log("");
  for (const r of resultados) console.log(`${r.ok ? (r.info ? "  i " : " OK ") : "FALTA"}  ${r.texto}`);
  const faltan = resultados.filter((r) => !r.ok);
  console.log(`\n${faltan.length === 0 ? "Nada que cambiar." : `${faltan.length} cambio(s) por hacer en la consola.`}`);
  process.exit(faltan.length === 0 ? 0 : 3);
}

if (require.main === module) {
  main().catch((e) => { console.error("ERROR:", e.code || "", e.message); process.exit(2); });
}

module.exports = { compararUmbrales, compararCalculos, compararDispositivo };
