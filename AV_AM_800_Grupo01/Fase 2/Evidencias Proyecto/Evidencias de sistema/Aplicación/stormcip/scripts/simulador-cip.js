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
// Modo --esperar (botón "Iniciar simulación" del dashboard): el proceso no termina.
// Escribe un latido en simulacionEstado/{linea} y escucha simulacionControl/{linea};
// cada orden "iniciar" (escenario normal o falla) corre un ciclo completo y "detener"
// lo deja abortado. Sigue siendo el único que crea ciclos, y no corre si la línea ya
// tiene uno en curso. El escenario viene en cada orden.
//   npm run sim:cip -- --esperar
//
// Flags:
//   --escenario normal|falla   (normal; no se usa con --esperar)
//   --duracion <s>             escala la receta de 300 s (mínimo para etapas de 6 s)
//   --linea <id>               (cip-01; con --esperar: cip-sim)
//   --dispositivo <id>         (wqs-lb-01; con --esperar: wqs-sim-01; su lineaId debe
//                              coincidir con --linea)
//   --tick <s>                 cada cuánto se escribe estadoProceso (2; mínimo 1,
//                              por el límite de ~1 escritura/s por documento)
//   --esperar                  modo escucha, ver arriba
//   --prod --project stormcip-972bd   producción: ambos flags explícitos,
//                              credenciales de `gcloud auth application-default login`
//                              (guardarraíles compartidos en entorno.js)

const path = require("path");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { resolverEntorno, inicializarAdmin } = require("./entorno");

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

const ESPERAR = flag("esperar");
const ESCENARIO = arg("escenario", "normal");
const DURACION = Number(arg("duracion", 300));
const LINEA = arg("linea", ESPERAR ? "cip-sim" : "cip-01");
const DISPOSITIVO = arg("dispositivo", ESPERAR ? "wqs-sim-01" : "wqs-lb-01");
const TICK_S = Number(arg("tick", 2));

if (ESPERAR && flag("escenario")) salir("--esperar recibe el escenario en cada orden del dashboard; no uses --escenario.");
if (!["normal", "falla"].includes(ESCENARIO)) salir("--escenario debe ser normal o falla");
if (!Number.isFinite(DURACION) || DURACION <= 0) salir("--duracion debe ser un número de segundos");
if (!Number.isFinite(TICK_S) || TICK_S < 1) {
  salir("--tick no puede ser menor a 1 s (límite de escrituras por documento de Firestore)");
}

// ── Entorno: emuladores por defecto, producción solo explícita (entorno.js) ─
const entorno = resolverEntorno({ flagsConValor: ["escenario", "duracion", "linea", "dispositivo", "tick"] });
const PROD = entorno.prod;
const projectId = entorno.projectId;
inicializarAdmin(entorno);
const URL_TTN = PROD
  ? `https://${projectId}.web.app/api/ttn-uplink`
  : `http://127.0.0.1:5001/${projectId}/southamerica-west1/ttnUplink`;

// El secreto nunca va en el código: en emuladores es el de functions/.secret.local
const SECRETO = process.env.TTN_WEBHOOK_SECRET;
if (!SECRETO) salir("Falta la variable de entorno TTN_WEBHOOK_SECRET.");

// ── Modelo y encoder compilados ──────────────────────────────
let modelo, encoder, tipos, reloj, control;
try {
  const lib = path.join(__dirname, "..", "functions", "lib");
  modelo = require(path.join(lib, "simulacion", "modeloCip"));
  encoder = require(path.join(lib, "wqsEncoder"));
  tipos = require(path.join(lib, "types"));
  reloj = require(path.join(lib, "simulacion", "relojCiclo"));
  control = require(path.join(lib, "simulacion", "controlSimulacion"));
} catch {
  salir("No se encontró functions/lib. Corre primero `npm run build` en functions/.");
}

const db = getFirestore();

// ── Espera interrumpible por Ctrl+C o por una orden "detener" ─
let abortar = false;          // el ciclo en curso debe terminar como abortado
let salirDelProceso = false;  // Ctrl+C: además, el proceso termina
let despertar = null;
const esperar = (ms) => new Promise((r) => {
  if (ms <= 0 || abortar) return r();
  const id = setTimeout(r, ms);
  despertar = () => { clearTimeout(id); r(); };
});
let hayCiclo = false;
process.on("SIGINT", () => {
  if (salirDelProceso) { console.error("\nSegundo Ctrl+C: salida inmediata."); process.exit(1); }
  salirDelProceso = true;
  if (ESPERAR && !hayCiclo) { console.log("\nCtrl+C: apago el simulador."); process.exit(0); }
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
async function crearCiclo(receta, plantaId, t0, escenario) {
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
      programa: `Demo CIP ${modelo.duracionReceta(receta)} s (${escenario})`,
      estado: "en_curso", etapaActual: receta[0].etapa,
      inicio: Timestamp.fromMillis(t0),
      consumos: { aguaTotal: 0, aguaRecuperada: 0, soda: 0, acido: 0 },
      simulado: true, escenario,
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

// ── Preparación y ejecución de UN ciclo ──────────────────────
/** Revisa el dispositivo y arma los parámetros. Lanza Error con el motivo si algo no calza. */
async function prepararCiclo() {
  const receta = modelo.escalarReceta(modelo.RECETA_DEFECTO, Math.round(DURACION));

  const dev = await db.doc(`dispositivos/${DISPOSITIVO}`).get();
  if (!dev.exists) throw new Error(`El dispositivo ${DISPOSITIVO} no existe (¿corriste el seed?).`);
  if (dev.get("lineaId") !== LINEA) {
    throw new Error(`El dispositivo ${DISPOSITIVO} pertenece a la línea ${dev.get("lineaId")}, no a ${LINEA}: ` +
                    "ttnUplink asignaría sus lecturas a otro ciclo.");
  }
  if (!String(dev.get("firmware") ?? "").startsWith("1.2")) {
    throw new Error(`El encoder genera formato de firmware 1.2; ${DISPOSITIVO} tiene firmware ${dev.get("firmware") ?? "sin registrar"}.`);
  }
  const modelosActivos = Object.values(dev.get("sondas") ?? {}).filter((s) => s.activa).map((s) => s.modelo);
  for (const m of ["DR-PH01", "DR-ECK1.0"]) {
    if (!modelosActivos.includes(m)) {
      throw new Error(`El simulador envía las sondas del equipo comprado (DR-PH01 + DR-ECK1.0); ` +
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
  return { receta, devEui, plantaId: dev.get("plantaId") ?? null, params };
}

/**
 * Corre un ciclo completo y devuelve "finalizado" o "abortado". Lanza Error si no
 * se pudo crear (p. ej. la línea ya tiene un ciclo en curso). `alCrear(cicloId)` se
 * llama en cuanto el ciclo existe.
 */
async function ejecutarCiclo(escenario, alCrear = () => {}) {
  const { receta, devEui, plantaId, params } = await prepararCiclo();
  const estadoEn = (t) => modelo.estadoEn(t, receta, escenario, params);

  pausaS = 0;
  const t0 = Date.now();
  const cicloRef = await crearCiclo(receta, plantaId, t0, escenario);
  const cicloId = cicloRef.id;
  alCrear(cicloId);
  const estadoRef = db.doc(`estadoProceso/${LINEA}`);
  const total = modelo.duracionReceta(receta);

  console.log(`Ciclo ${cicloId} · línea ${LINEA} · ${DISPOSITIVO} · escenario ${escenario} · ${total} s`);
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
        return "finalizado";
      }
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    abortar = true;
  }

  // Abortado (Ctrl+C, orden "detener" o error): ciclo cerrado como abortado y estado
  // completo, con la bomba apagada para que el dashboard no muestre una planta "andando".
  const t = tActual();
  const r = estadoEn(t);
  r.estadoProceso.circuito.bomba = { encendida: false, rpm: 0 };
  r.estadoProceso.instrumentos.caudal = 0;
  r.estadoProceso.instrumentos.presion = 0;
  await estadoRef.set(docEstado(r, cicloId, t0, "abortado"));
  await cicloRef.update({ estado: "abortado", fin: FieldValue.serverTimestamp(), consumos: r.consumos });
  console.log(`Ciclo ${cicloId} marcado como abortado en t=${t.toFixed(1)} s.`);
  return "abortado";
}

// ── Modo --esperar: latido y órdenes del dashboard ───────────
async function modoEsperar() {
  const estadoSimRef = db.doc(`simulacionEstado/${LINEA}`);
  const controlRef = db.doc(`simulacionControl/${LINEA}`);

  // Continúa el contador y recuerda la última orden aunque el proceso se reinicie
  const previo = (await estadoSimRef.get()).data() ?? {};
  let latido = Number(previo.latido) || 0;
  const estado = { estado: "libre", ultimaSolicitudId: previo.ultimaSolicitudId ?? null };
  let ejecutando = null;       // { cicloId, escenario } mientras corre un ciclo
  let ultimoRechazo = null;

  const escribir = async () => {
    latido += 1;
    await estadoSimRef.set({
      ...control.docEstado(
        { lineaId: LINEA, latido, ultimaSolicitudId: estado.ultimaSolicitudId, ultimoRechazo },
        ejecutando,
      ),
      latidoEn: FieldValue.serverTimestamp(),
    });
  };
  const latir = () => escribir().catch((e) => console.warn(`latido falló: ${e.message}`));

  console.log(`Modo --esperar · línea ${LINEA} · dispositivo ${DISPOSITIVO}`);
  console.log(`Entorno: ${PROD ? "PRODUCCIÓN" : "emuladores"} (${projectId}) · uplinks a ${URL_TTN}`);
  console.log(`Latido cada ${control.LATIDO_CADA_MS / 1000} s en simulacionEstado/${LINEA}; escuchando simulacionControl/${LINEA}. Ctrl+C para apagar.`);
  await escribir();
  setInterval(latir, control.LATIDO_CADA_MS);

  const correrCiclo = (escenario) => {
    estado.estado = "ejecutando";
    ejecutando = { cicloId: null, escenario };
    hayCiclo = true;
    abortar = false;
    ejecutarCiclo(escenario, (cicloId) => { ejecutando.cicloId = cicloId; latir(); })
      .catch((e) => { ultimoRechazo = e.message; console.error(`No se pudo iniciar: ${e.message}`); })
      .finally(() => {
        ejecutando = null;
        estado.estado = "libre";
        hayCiclo = false;
        abortar = false;
        if (salirDelProceso) { escribir().finally(() => process.exit(0)); return; }
        latir();
      });
    latir();
  };

  // Un snapshot a la vez, en orden
  let cola = Promise.resolve();
  const alOrden = (orden) => {
    const solicitadoEnMs = orden?.solicitadoEn?.toMillis ? orden.solicitadoEn.toMillis() : null;
    const d = control.decidir(orden, estado, { ahoraMs: Date.now(), solicitadoEnMs });
    if (d.accion === "ignorar") return;
    estado.ultimaSolicitudId = orden.solicitudId ?? estado.ultimaSolicitudId;
    if (d.accion === "rechazar") {
      ultimoRechazo = d.motivo;
      console.warn(`Orden ${orden?.solicitudId} rechazada: ${d.motivo}`);
      latir();
    } else if (d.accion === "detener") {
      ultimoRechazo = null;
      console.log(`Orden ${orden.solicitudId}: detener el ciclo ${ejecutando?.cicloId}.`);
      abortar = true;
      despertar?.();
    } else if (d.accion === "iniciar") {
      ultimoRechazo = null;
      console.log(`Orden ${orden.solicitudId} (${orden.solicitadoPor}): iniciar escenario ${d.escenario}.`);
      correrCiclo(d.escenario);
    }
  };
  controlRef.onSnapshot(
    (snap) => { cola = cola.then(() => alOrden(snap.exists ? snap.data() : null)).catch((e) => console.error(e)); },
    (e) => console.error(`No se pudo escuchar ${controlRef.path}: ${e.message}`),
  );
}

// ── Principal ────────────────────────────────────────────────
if (ESPERAR) {
  modoEsperar().catch((e) => salir(`Error: ${e.message}`));
} else {
  (async () => {
    try {
      const resultado = await ejecutarCiclo(ESCENARIO);
      process.exit(resultado === "finalizado" ? 0 : 1);
    } catch (e) {
      salir(e.message);
    }
  })();
}
