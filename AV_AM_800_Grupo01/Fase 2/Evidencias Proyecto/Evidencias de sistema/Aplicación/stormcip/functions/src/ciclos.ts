// Cierre de ciclo: calcula los indicadores agregados cuando un ciclo pasa a
// "finalizado". derivarCiclo() (calculos.ts) ya existía pero nadie lo invocaba.
//
// Alcance: solo se consideran las ETAPAS_MONITOREADAS (preenjuague, enjuague,
// enjuague_final). Las etapas químicas quedan fuera del MVP porque el WQS-LB no
// mide dentro de sus límites físicos ahí, así que incluirlas ensuciaría la curva
// de conductividad con datos que no son comparables.
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  getFirestore, FieldValue, Timestamp, DocumentReference,
} from "firebase-admin/firestore";
import { Derivacion, derivarCiclo } from "./calculos";
import { ETAPAS_MONITOREADAS, Etapa, PARAMS_DEFECTO, ParamsCalculo } from "./types";

// Tope de seguridad: un ciclo no debería pasar de unos cientos de lecturas
// (el WQS envía cada 20 min). Si se llega a este número, algo anda mal.
const LIMITE_LECTURAS = 5000;

/** Lectura tal como viene de Firestore, ya con el ts convertido a Date. */
export type LecturaCruda = {
  ts: Date;
  etapa: string;
  valores?: Record<string, number | null>;
  derivados?: Record<string, number>;
};

type LecturaCalculo = {
  ts: Date;
  valores: Record<string, number>;
  derivados?: Record<string, number>;
};

export type ResultadoIndicadores = {
  global: Derivacion | null;
  porEtapa: Partial<Record<Etapa, Derivacion>>;
  lecturasConsideradas: number;
};

/** null = sensor no conectado: no entra al cálculo, pero no invalida la lectura. */
function soloNumericos(v?: Record<string, number | null>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v ?? {})) {
    if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/**
 * Núcleo del cálculo. Función pura: sin Firestore, testeable sin emulador.
 *
 * Devuelve indicadores por etapa y un global. El volumen global NO se calcula
 * sobre el lapso completo (primera a última lectura monitoreada), porque entre
 * el preenjuague y el enjuague final hay etapas químicas donde no corre agua de
 * enjuague: se suma el volumen de cada etapa por separado.
 */
export function calcularIndicadoresCiclo(
  lecturas: LecturaCruda[], p: ParamsCalculo,
): ResultadoIndicadores {
  const monitoreadas = lecturas
    .filter((l) => (ETAPAS_MONITOREADAS as string[]).includes(l.etapa))
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());

  if (monitoreadas.length === 0) {
    return { global: null, porEtapa: {}, lecturasConsideradas: 0 };
  }

  const aCalculo = (l: LecturaCruda): LecturaCalculo => ({
    ts: l.ts, valores: soloNumericos(l.valores), derivados: l.derivados,
  });

  // 1. Por etapa: cada una con su propio inicio y fin reales
  const porEtapa: Partial<Record<Etapa, Derivacion>> = {};
  let volumenTotal = 0;
  let hayVolumen = false;

  for (const etapa of ETAPAS_MONITOREADAS) {
    const grupo = monitoreadas.filter((l) => l.etapa === etapa);
    if (grupo.length === 0) continue;
    const d = derivarCiclo(
      grupo.map(aCalculo), grupo[0].ts, grupo[grupo.length - 1].ts, p,
    );
    porEtapa[etapa] = d;
    if (typeof d.derivados.volumenEstimado === "number") {
      volumenTotal += d.derivados.volumenEstimado;
      hayVolumen = true;
    }
  }

  // 2. Global sobre todas las lecturas monitoreadas
  const global = derivarCiclo(
    monitoreadas.map(aCalculo),
    monitoreadas[0].ts,
    monitoreadas[monitoreadas.length - 1].ts,
    p,
  );

  // tiempoHastaLimpio global = el del enjuague final. Sobre todas las lecturas
  // monitoreadas tomaba la primera lectura limpia de cualquier etapa: un
  // enjuague intermedio limpio "aprobaba" un ciclo cuyo enjuague final quedó
  // sucio. Sin lecturas del enjuague final, o si nunca cumple el criterio, el
  // global queda sin valor.
  const final = porEtapa.enjuague_final;
  if (typeof final?.derivados.tiempoHastaLimpio === "number") {
    global.derivados.tiempoHastaLimpio = final.derivados.tiempoHastaLimpio;
    global.metodo.tiempoHastaLimpio = `enjuague final: ${final.metodo.tiempoHastaLimpio}, desde su primera lectura`;
    global.confianza.tiempoHastaLimpio = final.confianza.tiempoHastaLimpio;
  } else {
    delete global.derivados.tiempoHastaLimpio;
    delete global.metodo.tiempoHastaLimpio;
    delete global.confianza.tiempoHastaLimpio;
  }

  if (hayVolumen) {
    global.derivados.volumenEstimado = +volumenTotal.toFixed(3);
    global.metodo.volumenEstimado =
      `suma del volumen estimado de cada etapa monitoreada (${ETAPAS_MONITOREADAS.join(", ")})`;
    global.confianza.volumenEstimado = "estimado";
  } else {
    // Sin volumen por etapa, el global abarcaría los huecos de las etapas
    // químicas: preferimos no informarlo antes que informar un número inflado.
    delete global.derivados.volumenEstimado;
    delete global.metodo.volumenEstimado;
    delete global.confianza.volumenEstimado;
  }

  return { global, porEtapa, lecturasConsideradas: monitoreadas.length };
}

async function cargarParams(): Promise<ParamsCalculo> {
  const cfg = await getFirestore().doc("configuracion/calculos").get();
  return { ...PARAMS_DEFECTO, ...(cfg.data() ?? {}) } as ParamsCalculo;
}

async function cargarLecturas(cicloRef: DocumentReference): Promise<LecturaCruda[]> {
  const snap = await cicloRef.collection("lecturas")
    .orderBy("ts").limit(LIMITE_LECTURAS).get();

  return snap.docs.map((doc) => {
    const d = doc.data();
    const ts = d.ts instanceof Timestamp ? d.ts.toDate() : new Date(d.ts);
    return {
      ts,
      etapa: String(d.etapa ?? ""),
      valores: d.valores as Record<string, number | null> | undefined,
      derivados: d.derivados as Record<string, number> | undefined,
    };
  }).filter((l) => !Number.isNaN(l.ts.getTime()));
}

async function escribirIndicadores(
  cicloRef: DocumentReference, r: ResultadoIndicadores,
) {
  await cicloRef.set({
    indicadores: r.global?.derivados ?? {},
    indicadoresMetodo: r.global?.metodo ?? {},
    indicadoresConfianza: r.global?.confianza ?? {},
    indicadoresPorEtapa: r.porEtapa,
    lecturasConsideradas: r.lecturasConsideradas,
    indicadoresCalculadosEn: FieldValue.serverTimestamp(),
    recalcular: FieldValue.delete(),   // consume la bandera de mantenimiento
  }, { merge: true });
}

/**
 * Trigger de cierre de ciclo. Se dispara en dos casos:
 *
 *  1. El ciclo entra en estado "finalizado" (flujo normal).
 *  2. Alguien escribe `recalcular: true` en el documento (mantenimiento:
 *     ciclos que ya estaban cerrados antes de existir este trigger, o
 *     recálculo tras cambiar `configuracion/calculos`).
 *
 * Guarda contra el bucle infinito: esta función escribe sobre el mismo
 * documento que la dispara, pero no toca `estado` y borra `recalcular`, así
 * que en la reinvocación ninguna de las dos condiciones se cumple.
 */
export const alCerrarCiclo = onDocumentUpdated("ciclos/{cicloId}", async (event) => {
  const antes = event.data?.before;
  const despues = event.data?.after;
  if (!antes || !despues) return;

  const seCerro = despues.get("estado") === "finalizado" &&
                  antes.get("estado") !== "finalizado";
  const pidenRecalculo = despues.get("recalcular") === true &&
                         antes.get("recalcular") !== true;
  if (!seCerro && !pidenRecalculo) return;

  const params = await cargarParams();
  const lecturas = await cargarLecturas(despues.ref);
  const r = calcularIndicadoresCiclo(lecturas, params);

  if (r.lecturasConsideradas === 0) {
    console.warn(
      `Ciclo ${event.params.cicloId} sin lecturas en etapas monitoreadas`,
    );
  }
  await escribirIndicadores(despues.ref, r);
  console.log(
    `Ciclo ${event.params.cicloId}: indicadores calculados sobre ` +
    `${r.lecturasConsideradas} lecturas (motivo: ${seCerro ? "cierre" : "recálculo"})`,
  );
});

/**
 * Recálculo manual para un admin autenticado. Pensada para un botón
 * "recalcular" en el dashboard; para mantenimiento desde la terminal conviene
 * el script scripts/recalcular.js, que no necesita sesión de usuario.
 */
export const recalcularIndicadores = onCall(async (req) => {
  if (req.auth?.token.rol !== "admin") {
    throw new HttpsError("permission-denied", "Solo un admin puede recalcular");
  }
  const { cicloId } = (req.data ?? {}) as { cicloId?: string };
  if (!cicloId) throw new HttpsError("invalid-argument", "Se requiere cicloId");

  const cicloRef = getFirestore().doc(`ciclos/${cicloId}`);
  if (!(await cicloRef.get()).exists) {
    throw new HttpsError("not-found", `El ciclo ${cicloId} no existe`);
  }

  const params = await cargarParams();
  const r = calcularIndicadoresCiclo(await cargarLecturas(cicloRef), params);
  await escribirIndicadores(cicloRef, r);

  return {
    ok: true,
    lecturasConsideradas: r.lecturasConsideradas,
    indicadores: r.global?.derivados ?? {},
  };
});