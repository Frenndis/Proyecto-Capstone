// Simula un ciclo CIP completo para la presentación (5 min por defecto).
//
//  - Estado de planta (lo que en la realidad vendría del PLC): se escribe en
//    estadoProceso/{lineaId} cada --tick segundos, sobrescrito completo.
//  - Lecturas de sondas: se codifican como un uplink real del WQS-LB y entran
//    por ttnUplink, igual que un equipo en terreno (decoder, validación física,
//    derivados y alertas incluidos). Configuración del equipo comprado:
//    DR-PH01 + DR-ECK1.0, sin turbidez ni DS18B20.
//  - Crea el ciclo al inicio y lo pasa a "finalizado" al terminar, lo que
//    dispara alCerrarCiclo (indicadores). Ctrl+C lo deja "abortado".
//  - Si el equipo se suspende o el proceso se bloquea (> 5 s de atraso), el
//    ciclo se pausa en vez de recuperar el tiempo: no hay ráfaga de uplinks y
//    el progreso no salta (functions/src/simulacion/relojCiclo.ts).
//
// El modelo físico vive en functions/src/simulacion/modeloCip.ts y el encoder
// en functions/src/wqsEncoder.ts: este script usa la versión COMPILADA, así que
// antes hay que correr `npm run build` en functions/.
//
// Uso, desde scripts/ (emuladores; el secreto es el de functions/.secret.local):
//   set TTN_WEBHOOK_SECRET=test-secret            (cmd)
//   npm run sim:cip -- --escenario normal
//   npm run sim:cip -- --escenario falla --duracion 180
//
// Flags:
//   --escenario normal|falla   (normal)
//   --duracion <s>             escala la receta de 300 s (mínimo para etapas de 6 s)
//   --linea <id>               (cip-01)
//   --dispositivo <id>         (wqs-lb-01; su lineaId debe coincidir con --linea)
//   --tick <s>                 cada cuánto se escribe estadoProceso (2; mínimo 1,
//                              por el límite de ~1 escritura/s por documento)
//   --prod --project stormcip-972bd   producción: ambos flags explícitos,
//                              credenciales de `gcloud auth application-default login`

const path = require("path");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { PROJECT_ID } = require("./config");

const PROYECTO_PROD = "stormcip-972bd";
const UPLINK_CADA_S = 10;
const UPLINK_DESFASE_S = 5;   // ver instantesUplink en modeloCip.ts
const BATERIA_V = 3.6;
// dev_eui de respaldo si el dispositivo no tiene devEui registrado (seed.js no
// lo define). Solo se usa para armar el lecturaId determinista en ttnUplink.
const DEV_EUI_SIMULADO = "5349434950000001";

// ── Argumentos ───────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const arg = (n, def) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const salir = (msg) => { console.error(msg); process.exit(1); };

const ESCENARIO = arg("escenario", "normal");
const DURACION = Number(arg("duracion", 300));
const LINEA = arg("linea", "cip-01");
const DISPOSITIVO = arg("dispositivo", "wqs-lb-01");
const TICK_S = Number(arg("tick", 2));
const PROD = flag("prod");
const PROYECTO = arg("project");

if (!["normal", "falla"].includes(ESCENARIO)) salir("--escenario debe ser normal o falla");
if (!Number.isFinite(DURACION) || DURACION <= 0) salir("--duracion debe ser un número de segundos");
if (!Number.isFinite(TICK_S) || TICK_S < 1) {
  salir("--tick no puede ser menor a 1 s (límite de escrituras por documento de Firestore)");
}

// ── Entorno: emuladores por defecto, producción solo explícita ─
let projectId, URL_TTN;
if (PROD) {
  if (PROYECTO !== PROYECTO_PROD) salir(`Producción requiere --prod --project ${PROYECTO_PROD} explícitos.`);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    salir("FIRESTORE_EMULATOR_HOST está definido: no se mezcla producción con emuladores.");
  }
  projectId = PROYECTO_PROD;
  URL_TTN = `https://${PROYECTO_PROD}.web.app/api/ttn-uplink`;
  initializeApp({ credential: applicationDefault(), projectId });
} else {
  if (PROYECTO) salir("--project solo se usa junto con --prod. Sin --prod se usan los emuladores.");
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  projectId = PROJECT_ID;
  URL_TTN = `http://127.0.0.1:5001/${projectId}/southamerica-west1/ttnUplink`;
  initializeApp({ projectId });
}

// El secreto nunca va en el código: en emuladores es el de functions/.secret.local
const SECRETO = process.env.TTN_WEBHOOK_SECRET;
if (!SECRETO) salir("Falta la variable de entorno TTN_WEBHOOK_SECRET.");

// ── Modelo y encoder compilados ──────────────────────────────
let modelo, encoder, tipos, reloj;
try {
  const lib = path.join(__dirname, "..", "functions", "lib");
  modelo = require(path.join(lib, "simulacion", "modeloCip"));
  encoder = require(path.join(lib, "wqsEncoder"));
  tipos = require(path.join(lib, "types"));
  reloj = require(path.join(lib, "simulacion", "relojCiclo"));
} catch {
  salir("No se encontró functions/lib. Corre primero `npm run build` en functions/.");
}

const db = getFirestore();

// ── Espera interrumpible por Ctrl+C ──────────────────────────
let abortar = false;
let despertar = null;
const esperar = (ms) => new Promise((r) => {
  if (ms <= 0 || abortar) return r();
  const id = setTimeout(r, ms);
  despertar = () => { clearTimeout(id); r(); };
});
process.on("SIGINT", () => {
  if (abortar) { console.error("\nSegundo Ctrl+C: salida inmediata."); process.exit(1); }
  abortar = true;
  console.log("\nCtrl+C: termino la escritura en curso y dejo el ciclo como abortado…");
  despertar?.();
});

// ── Firestore ────────────────────────────────────────────────
function idCiclo(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `SIM-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
         `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Crea el ciclo solo si la línea no tiene otro en curso (en la misma transacción). */
async function crearCiclo(receta, plantaId, t0) {
  const ref = db.doc(`ciclos/${idCiclo(t0)}`);
  await db.runTransaction(async (tx) => {
    const enCurso = await tx.get(db.collection("ciclos")
      .where("lineaId", "==", LINEA).where("estado", "==", "en_curso").limit(1));
    if (!enCurso.empty) {
      throw new Error(
        `La línea ${LINEA} ya tiene un ciclo en curso (${enCurso.docs[0].id}). ` +
        "Ciérralo antes de simular (ver cerrar-ciclo.js).",
      );
    }
    tx.create(ref, {
      plantaId, lineaId: LINEA, camion: "SIM-DEMO",
      programa: `Demo CIP ${modelo.duracionReceta(receta)} s (${ESCENARIO})`,
      estado: "en_curso", etapaActual: receta[0].etapa,
      inicio: Timestamp.fromMillis(t0),
      consumos: { aguaTotal: 0, aguaRecuperada: 0, soda: 0, acido: 0 },
      simulado: true, escenario: ESCENARIO,
    });
  });
  return ref;
}

// Pausa acumulada del ciclo (s): si el equipo se suspende, el ciclo se pausa en
// vez de recuperar el tiempo perdido (ver relojCiclo.ts).
let pausaS = 0;

/** Documento completo de estadoProceso: se sobrescribe sin merge. */
function docEstado(r, cicloId, t0, estadoCiclo) {
  return {
    v: tipos.ESTADO_PROCESO_VERSION, lineaId: LINEA, cicloId,
    simulado: true, fuente: "simulador-cip",
    actualizadoEn: FieldValue.serverTimestamp(),
    estadoCiclo,
    ...r.estadoProceso,
    // Corrido por la pausa: así el progreso que calcule el dashboard no salta
    etapaInicio: Timestamp.fromMillis(reloj.momentoReal(t0, r.etapaInicioS, pausaS)),
  };
}

// ── Uplink por ttnUplink ─────────────────────────────────────
async function enviarUplink(r, devEui) {
  const bytes = encoder.encodeWqsFPort2(modelo.datosUplinkWqs(r.sondas, BATERIA_V));
  const body = {
    end_device_ids: { device_id: DISPOSITIVO, dev_eui: devEui },
    uplink_message: { f_port: 2, frm_payload: Buffer.from(bytes).toString("base64") },
    received_at: new Date().toISOString(),
  };
  const res = await fetch(URL_TTN, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": SECRETO },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const texto = await res.text();
  if (res.status === 401) throw new Error("ttnUplink rechazó el secreto (401): revisa TTN_WEBHOOK_SECRET.");
  let json = {};
  try { json = JSON.parse(texto); } catch { /* respuesta no JSON */ }
  const descartadas = Object.entries(json.descartadas ?? {}).map(([v, m]) => `${v} (${m})`);
  const detalle = json.ignorado ? `ignorado: ${json.motivo}` :
    `alertas ${json.alertas ?? "?"}${descartadas.length ? ` · descartadas ${descartadas.join(", ")}` : ""}`;
  return `${res.status} ${detalle}`;
}

// ── Programa de eventos ──────────────────────────────────────
// Orden dentro del mismo instante: primero el cambio de etapa (ttnUplink toma
// la etapa de ciclos/{id}.etapaActual), después el estado y al final el uplink.
const PRIORIDAD = { etapa: 0, tick: 1, uplink: 2, fin: 3 };

function programa(receta) {
  const total = modelo.duracionReceta(receta);
  const ev = [];
  let inicio = 0;
  receta.forEach((p, i) => { if (i > 0) ev.push({ t: inicio, tipo: "etapa", etapa: p.etapa }); inicio += p.duracionS; });
  for (let t = 0; t < total; t += TICK_S) ev.push({ t, tipo: "tick" });
  for (const t of modelo.instantesUplink(receta, UPLINK_CADA_S, UPLINK_DESFASE_S)) ev.push({ t, tipo: "uplink" });
  ev.push({ t: total, tipo: "fin" });
  return ev.sort((a, b) => a.t - b.t || PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo]);
}

// ── Principal ────────────────────────────────────────────────
(async () => {
  let receta;
  try { receta = modelo.escalarReceta(modelo.RECETA_DEFECTO, Math.round(DURACION)); }
  catch (e) { salir(e.message); }

  const dev = await db.doc(`dispositivos/${DISPOSITIVO}`).get();
  if (!dev.exists) salir(`El dispositivo ${DISPOSITIVO} no existe (¿corriste el seed?).`);
  if (dev.get("lineaId") !== LINEA) {
    salir(`El dispositivo ${DISPOSITIVO} pertenece a la línea ${dev.get("lineaId")}, no a ${LINEA}: ` +
          "ttnUplink asignaría sus lecturas a otro ciclo.");
  }
  if (!String(dev.get("firmware") ?? "").startsWith("1.2")) {
    salir(`El encoder genera formato de firmware 1.2; ${DISPOSITIVO} tiene firmware ${dev.get("firmware") ?? "sin registrar"}.`);
  }
  const modelosActivos = Object.values(dev.get("sondas") ?? {}).filter((s) => s.activa).map((s) => s.modelo);
  for (const m of ["DR-PH01", "DR-ECK1.0"]) {
    if (!modelosActivos.includes(m)) {
      salir(`El simulador envía las sondas del equipo comprado (DR-PH01 + DR-ECK1.0); ` +
            `${DISPOSITIVO} no tiene ${m} activa (¿seed antiguo? vuelve a correr npm run seed).`);
    }
  }
  const devEui = dev.get("devEui") ?? DEV_EUI_SIMULADO;

  const cfg = (await db.doc("configuracion/calculos").get()).data() ?? {};
  const params = {
    ...modelo.PARAMS_MODELO_DEFECTO,
    conductividadAguaRed: cfg.conductividadAguaRed ?? tipos.PARAMS_DEFECTO.conductividadAguaRed,
    factorCompensacionEC: cfg.factorCompensacionEC ?? tipos.PARAMS_DEFECTO.factorCompensacionEC,
    caudalNominalM3h: cfg.caudalNominalM3h ?? tipos.PARAMS_DEFECTO.caudalNominalM3h,
  };
  const estadoEn = (t) => modelo.estadoEn(t, receta, ESCENARIO, params);

  const t0 = Date.now();
  let cicloRef;
  try { cicloRef = await crearCiclo(receta, dev.get("plantaId") ?? null, t0); }
  catch (e) { salir(e.message); }
  const cicloId = cicloRef.id;
  const estadoRef = db.doc(`estadoProceso/${LINEA}`);
  const total = modelo.duracionReceta(receta);

  console.log(`Ciclo ${cicloId} · línea ${LINEA} · ${DISPOSITIVO} · escenario ${ESCENARIO} · ${total} s`);
  console.log(`Entorno: ${PROD ? "PRODUCCIÓN" : "emuladores"} (${projectId}) · uplinks a ${URL_TTN}`);
  console.log(`--- ${receta[0].etapa}`);

  const tActual = () => reloj.tiempoModelo(Date.now(), t0, pausaS, total);
  // Si al llegar el evento el bucle va atrasado más de 5 s (suspensión,
  // bloqueo), se pausa el ciclo: el evento queda a tiempo y los siguientes
  // conservan su cadencia, sin ráfaga de uplinks atrasados.
  const esperarEvento = async (ev) => {
    let plan = reloj.planificarEspera(Date.now(), t0, ev.t, pausaS);
    if (plan.esperarMs > 0) {
      await esperar(plan.esperarMs);
      // La suspensión puede ocurrir durante la espera: se vuelve a medir
      plan = reloj.planificarEspera(Date.now(), t0, ev.t, pausaS);
    }
    if (plan.pausadoS > 0) {
      pausaS = plan.pausaS;
      console.warn(`  ⚠ atraso de ${plan.pausadoS.toFixed(1)} s (¿equipo suspendido?): ` +
                   `ciclo pausado y reanudado en t=${ev.t}s (pausa total ${pausaS.toFixed(1)} s)`);
    }
  };
  try {
    for (const ev of programa(receta)) {
      await esperarEvento(ev);
      if (abortar) break;

      if (ev.tipo === "etapa") {
        const r = estadoEn(ev.t);
        await cicloRef.update({ etapaActual: ev.etapa, consumos: r.consumos });
        console.log(`--- ${ev.etapa}  (consumos: agua ${r.consumos.aguaTotal} m³, ` +
                    `recuperada ${r.consumos.aguaRecuperada} m³, soda ${r.consumos.soda} L, ácido ${r.consumos.acido} L)`);
      } else if (ev.tipo === "tick") {
        await estadoRef.set(docEstado(estadoEn(tActual()), cicloId, t0, "en_curso"));
      } else if (ev.tipo === "uplink") {
        const r = estadoEn(ev.t);
        try {
          const resultado = await enviarUplink(r, devEui);
          console.log(`  t=${String(ev.t).padStart(3)}s  uplink ${resultado}`);
        } catch (e) {
          if (e.message.includes("401")) throw e;
          console.warn(`  t=${String(ev.t).padStart(3)}s  uplink falló: ${e.message}`);
        }
      } else if (ev.tipo === "fin") {
        const r = estadoEn(total);   // bomba apagada
        await estadoRef.set(docEstado(r, cicloId, t0, "finalizado"));
        await cicloRef.update({ estado: "finalizado", fin: FieldValue.serverTimestamp(), consumos: r.consumos });
        console.log(`Ciclo ${cicloId} finalizado. alCerrarCiclo calcula los indicadores en unos segundos.`);
        console.log(`Consumos: ${JSON.stringify(r.consumos)}`);
        process.exit(0);
      }
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    abortar = true;
  }

  // Abortado (Ctrl+C o error): ciclo cerrado como abortado y estado completo,
  // con la bomba apagada para que el dashboard no muestre una planta "andando".
  const t = tActual();
  const r = estadoEn(t);
  r.estadoProceso.circuito.bomba = { encendida: false, rpm: 0 };
  r.estadoProceso.instrumentos.caudal = 0;
  r.estadoProceso.instrumentos.presion = 0;
  await estadoRef.set(docEstado(r, cicloId, t0, "abortado"));
  await cicloRef.update({ estado: "abortado", fin: FieldValue.serverTimestamp(), consumos: r.consumos });
  console.log(`Ciclo ${cicloId} marcado como abortado en t=${t.toFixed(1)} s.`);
  process.exit(1);
})();
