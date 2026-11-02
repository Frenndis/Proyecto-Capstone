// Funciones de la planta de demostración, sin depender de un computador encendido:
//  · iniciarCicloDemo: corre un ciclo en vivo a 20× desde la nube.
//  · recalcularDecisiones (trigger): al cerrar un ciclo, actualiza las decisiones.
//  · planificarCiclos (cada hora): la planta sigue limpiando sus circuitos cada día.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import {
  CIRCUITOS, Contexto, Opciones, cicloCerrado, circuitoPorId, contextoPara, crearSimulador, fasesDelCiclo, litrosPorSDe, probDesvio, puntoDe, resumir,
} from "./motor";
import { CicloML, PrediccionCiclo, analizar, entrenarEnVivo } from "./ml";

export const VELOCIDAD = 20;
const TICK_MS = 1000;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Correlativo del registro (CIP-4812). */
async function siguienteNumero() {
  const db = getFirestore();
  const ref = db.doc("configuracion/contador");
  return db.runTransaction(async (tx) => {
    const n = ((await tx.get(ref)).get("n") as number | undefined ?? 4000) + 1;
    tx.set(ref, { n }, { merge: true });
    return `CIP-${n}`;
  });
}

function aDocumento(d: ReturnType<typeof cicloCerrado>) {
  const { inicioMs, finMs, ...resto } = d;
  return { ...resto, inicio: Timestamp.fromMillis(inicioMs), fin: Timestamp.fromMillis(finMs) };
}

export const iniciarCicloDemo = onCall({ timeoutSeconds: 540, memory: "1GiB" }, async (req) => {
  const rol = req.auth?.token.rol;
  if (rol !== "admin" && rol !== "operador") throw new HttpsError("permission-denied", "Solo operación puede iniciar un ciclo");
  const { circuitoId, escenario } = (req.data ?? {}) as { circuitoId?: string; escenario?: string };
  const c = circuitoPorId(circuitoId ?? "");
  if (!c) throw new HttpsError("invalid-argument", "Circuito desconocido");

  const db = getFirestore();
  const enCurso = await db.collection("ciclos").where("lineaId", "==", c.id).where("estado", "==", "en_curso").limit(1).get();
  if (!enCurso.empty) {
    const previo = enCurso.docs[0];
    // Un ciclo cuya función terminó sin cerrarlo no debe bloquear el circuito para siempre
    const vivo = previo.get("vivoEn") as Timestamp | undefined;
    if (vivo && Date.now() - vivo.toMillis() < 15000) throw new HttpsError("failed-precondition", `${c.corto} ya tiene un ciclo en curso`);
    await previo.ref.update({ estado: "abortado", fin: Timestamp.now() });
  }

  // La predicción ya la dejó el último entrenamiento completo, al cerrar un ciclo
  const guardadas = (await db.doc("configuracion/oportunidades").get()).get("predicciones") as
    { circuitoId: string; ml?: PrediccionCiclo; contexto?: Contexto }[] | undefined;
  const guardada = guardadas?.find((p) => p.circuitoId === c.id);
  const prediccion = guardada?.ml;
  const contexto = guardada?.contexto ?? contextoPara(c, new Date(), Date.now() % 100000);
  const o: Opciones = { semilla: Date.now() % 100000, desvio: escenario === "desvio", contexto };
  const sim = crearSimulador(c, o);
  const numero = await siguienteNumero();
  const ref = db.collection("ciclos").doc(numero);
  const inicioMs = Date.now();
  await ref.set({
    v: 3, numero, plantaId: "demo", lineaId: c.id, circuitoId: c.id, circuito: c.nombre, area: c.area,
    programa: c.receta, recetaVersion: "v3", lead: c.lead, operador: "Turno A · Central CIP",
    estado: "en_curso", etapaActual: c.fases[0].etapa, faseIdx: 0, velocidad: VELOCIDAD,
    fases: fasesDelCiclo(c, o), curva: [puntoDe(sim.en(0))], litrosPorS: litrosPorSDe(c), contexto,
    ...(prediccion ? { prediccion } : {}),
    inicio: Timestamp.fromMillis(inicioMs), vivoEn: Timestamp.now(),
    consumos: { aguaTotal: 0, aguaRecuperada: 0, soda: 0, acido: 0 }, simulado: true, demo: true, escenario: o.desvio ? "desvio" : "normal",
  });

  const predecirVivo = entrenarEnVivo(await leerHistoria(c.id), c.id);
  const curva = [puntoDe(sim.en(0))];
  let t = 0;
  const vistos = new Set<string>();
  const enVivo: Record<string, { s: number; margen: number }> = {};
  while (t < sim.dur) {
    await espera(TICK_MS);
    if ((await ref.get()).get("detener") === true) {
      await ref.update({ estado: "abortado", fin: Timestamp.now() });
      return { ok: true, numero, abortado: true };
    }
    // Cuatro puntos por segundo real dan una curva suave sin escribir de más
    const hasta = Math.min(t + VELOCIDAD, sim.dur);
    for (let k = 1; k <= 4; k++) curva.push(puntoDe(sim.en(t + ((hasta - t) * k) / 4)));
    t = hasta;
    const m = sim.en(t);
    // Al 15 % de un enjuague, el modelo corrige su predicción con lo ya medido
    const fa = c.fases[m.i];
    const durFase = sim.durDe(m.i);
    const vivo = fa.enjuague && !vistos.has(fa.n) && m.dentro >= durFase * 0.15
      ? predecirVivo(fa.n, durFase, Math.round(sim.en(sim.inicioDe(m.i) + durFase * 0.15).ec * sim.ruido15), contexto) : null;
    if (vivo) { vistos.add(fa.n); enVivo[fa.n] = vivo; }
    await ref.update({
      ...(vivo ? { prediccionVivo: enVivo } : {}),
      curva, faseIdx: m.i, etapaActual: c.fases[m.i].etapa, vivoEn: Timestamp.now(),
      "consumos.aguaTotal": +(m.agua / 1000).toFixed(3),
    });
  }

  const r = resumir(c, o);
  await ref.update({
    estado: "finalizado", fin: Timestamp.fromMillis(inicioMs + (r.duracionS / VELOCIDAD) * 1000), resumen: r,
    "consumos.aguaTotal": +(r.aguaL / 1000).toFixed(3), actualizadoEn: FieldValue.serverTimestamp(),
  });
  return { ok: true, numero };
});

async function leerHistoria(circuitoId?: string): Promise<CicloML[]> {
  const ciclos = getFirestore().collection("ciclos");
  const snap = await (circuitoId ? ciclos.where("lineaId", "==", circuitoId) : ciclos).orderBy("inicio", "desc").limit(circuitoId ? 120 : 1000).get();
  return snap.docs.map((d) => d.data())
    .filter((c) => c.v === 3 && c.estado === "finalizado" && c.resumen)
    .map((c) => ({
      circuitoId: c.circuitoId, circuito: c.circuito, inicioMs: (c.inicio as Timestamp).toMillis(),
      resumen: c.resumen, litrosPorS: c.litrosPorS ?? {}, ...(c.contexto ? { contexto: c.contexto } : {}),
    }));
}

/** Reentrena los modelos y escribe configuracion/oportunidades. */
export async function actualizarOportunidades() {
  const db = getFirestore();
  const r = analizar(await leerHistoria(), Date.now());
  await db.doc("configuracion/oportunidades").set({ ...r, actualizadoEn: Timestamp.now() });
  return r;
}

export const recalcularDecisiones = onDocumentUpdated({ document: "ciclos/{cicloId}", memory: "1GiB", timeoutSeconds: 300 }, async (event) => {
  const antes = event.data?.before, despues = event.data?.after;
  if (!antes || !despues) return;
  if (despues.get("v") !== 3 || despues.get("estado") !== "finalizado" || antes.get("estado") === "finalizado") return;
  await actualizarOportunidades();
});

/** Hora local de la planta (Santiago). */
const horaChile = (d: Date) => Number(d.toLocaleString("en-US", { timeZone: "America/Santiago", hour: "numeric", hour12: false }));
const diaChile = (d: Date) => new Date(d.toLocaleString("en-US", { timeZone: "America/Santiago" })).getDay();

export const planificarCiclos = onSchedule({ schedule: "every 60 minutes", timeZone: "America/Santiago", region: "southamerica-east1", memory: "1GiB", timeoutSeconds: 300 }, async () => {
  const ahora = new Date();
  const hora = horaChile(ahora), dia = diaChile(ahora);
  const db = getFirestore();
  let creados = 0;
  for (const c of CIRCUITOS) {
    if (c.hora !== hora || c.libres.includes(dia)) continue;
    const semilla = Math.floor(ahora.getTime() / 3600000) + c.hora * 7;
    const contexto = contextoPara(c, ahora, semilla);
    const o: Opciones = {
      semilla, contexto,
      desvio: Math.random() < probDesvio(c, contexto),
      fugaFinal: c.id === "and2" ? 1.7 : undefined,
    };
    const numero = await siguienteNumero();
    const duracion = resumir(c, o).duracionS * 1000;
    await db.doc(`ciclos/${numero}`).set(aDocumento(cicloCerrado(c, o, ahora.getTime() - duracion, numero)));
    creados++;
  }
  if (creados) await actualizarOportunidades();
});
