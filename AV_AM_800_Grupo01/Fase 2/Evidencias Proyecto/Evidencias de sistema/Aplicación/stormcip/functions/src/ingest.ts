import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "crypto";
import {
  VARIABLES, ETAPAS, Variable, Etapa, Umbrales, Sonda, EspecVariable, CATALOGO_SONDAS,
} from "./types";

/**
 * POST /api/ingest   header: x-api-key
 * body: { deviceId, cicloId, etapa, ts?(ms), valores: { temperatura, caudal, ... } }
 * Punto de entrada único para ESP32 / gateway / simulador.
 */
export const ingestLectura = onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Usar POST" }); return; }

  const db = getFirestore();
  const { deviceId, cicloId, etapa, ts, valores } = req.body ?? {};
  const apiKey = req.get("x-api-key");

  if (!deviceId || !cicloId || !etapa || !valores || !apiKey) {
    res.status(400).json({ error: "Faltan campos: deviceId, cicloId, etapa, valores, x-api-key" });
    return;
  }
  if (!ETAPAS.includes(etapa as Etapa)) {
    res.status(400).json({ error: `Etapa inválida. Usar: ${ETAPAS.join(", ")}` });
    return;
  }

  // 1. Autenticar dispositivo (se guarda solo el hash de la API key)
  const dev = await db.doc(`dispositivos/${deviceId}`).get();
  const hash = createHash("sha256").update(apiKey).digest("hex");
  if (!dev.exists || dev.get("apiKeyHash") !== hash || dev.get("activo") === false) {
    res.status(401).json({ error: "Dispositivo no autorizado" });
    return;
  }

  // 2. Validar valores (solo variables conocidas y numéricas)
  const limpios: Partial<Record<Variable, number>> = {};
  for (const v of VARIABLES) {
    const n = valores[v];
    if (n === undefined) continue;
    if (typeof n !== "number" || !Number.isFinite(n)) {
      res.status(400).json({ error: `Valor inválido en ${v}` });
      return;
    }
    limpios[v] = n;
  }
  if (Object.keys(limpios).length === 0) {
    res.status(400).json({ error: "Sin variables válidas" });
    return;
  }

  // 2b. Si el dispositivo declara sondas (unidad WQS-LB), validar pertenencia y rango físico.
  // Dispositivos sin `sondas` (ej. esp32-01) mantienen la validación anterior sin cambios.
  const sondas = dev.get("sondas") as Sonda[] | undefined;
  if (sondas?.length) {
    const especPorVariable = new Map<Variable, EspecVariable>();
    for (const { modelo } of sondas) {
      for (const [v, espec] of Object.entries(CATALOGO_SONDAS[modelo])) {
        especPorVariable.set(v as Variable, espec as EspecVariable);
      }
    }
    for (const [v, n] of Object.entries(limpios) as [Variable, number][]) {
      const espec = especPorVariable.get(v);
      if (!espec) {
        res.status(400).json({ error: `El dispositivo no tiene una sonda para "${v}"` });
        return;
      }
      if (n < espec.min || n > espec.max) {
        res.status(400).json({
          error: `Valor de ${v} fuera de rango físico (${espec.min}–${espec.max} ${espec.unidad})`,
        });
        return;
      }
    }
  }

  // 3. Ciclo y umbrales de la etapa
  const cicloRef = db.doc(`ciclos/${cicloId}`);
  const [ciclo, cfg] = await Promise.all([cicloRef.get(), db.doc("configuracion/umbrales").get()]);
  if (!ciclo.exists) { res.status(404).json({ error: "Ciclo no existe" }); return; }
  const umbrales = (cfg.get(etapa) ?? {}) as Umbrales;
  const momento = typeof ts === "number" ? Timestamp.fromMillis(ts) : Timestamp.now();

  // 4. Escritura atómica: lectura + estado del ciclo + alertas
  const batch = db.batch();
  const lecturaRef = cicloRef.collection("lecturas").doc();
  batch.set(lecturaRef, { ts: momento, etapa, deviceId, ...limpios });
  batch.update(cicloRef, {
    etapaActual: etapa,
    ultimaLectura: { ts: momento, ...limpios },
    actualizadoEn: FieldValue.serverTimestamp(),
  });

  let alertas = 0;
  for (const [v, valor] of Object.entries(limpios) as [Variable, number][]) {
    const r = umbrales[v];
    if (!r) continue;
    const fuera = (r.min !== undefined && valor < r.min) || (r.max !== undefined && valor > r.max);
    if (!fuera) continue;
    batch.set(db.collection("alertas").doc(), {
      cicloId, lineaId: ciclo.get("lineaId") ?? null, etapa, variable: v, valor,
      min: r.min ?? null, max: r.max ?? null,
      severidad: "advertencia", ts: momento, reconocida: false,
    });
    alertas++;
  }
  batch.update(dev.ref, { ultimoPing: FieldValue.serverTimestamp() });
  await batch.commit();

  res.status(201).json({ ok: true, lecturaId: lecturaRef.id, alertas });
});
