// Endpoint HTTP legado: ESP32 / gateway / simulador envían JSON directo.
// Solo se encarga de autenticar y traducir la petición; la validación de
// datos y la escritura viven en procesarLectura() (ingest.ts), compartida
// con el adaptador LoRaWAN.
import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { ETAPAS, Etapa, Dispositivo } from "./types";
import { procesarLectura } from "./ingest";

export const ingestLectura = onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Usar POST" }); return; }

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

  // Autenticación del dispositivo: en Firestore solo se guarda el hash
  const snap = await getFirestore().doc(`dispositivos/${deviceId}`).get();
  const hash = createHash("sha256").update(apiKey).digest("hex");
  if (!snap.exists || snap.get("apiKeyHash") !== hash || snap.get("activo") === false) {
    res.status(401).json({ error: "Dispositivo no autorizado" });
    return;
  }

  const r = await procesarLectura({
    deviceId,
    dispositivo: snap.data() as Dispositivo,
    cicloId,
    etapa: etapa as Etapa,
    valores,
    ts: typeof ts === "number" ? Timestamp.fromMillis(ts) : Timestamp.now(),
  });

  if (!r.ok) { res.status(r.codigo).json({ error: r.error }); return; }
  res.status(201).json({
    ok: true, lecturaId: r.lecturaId, alertas: r.alertas,
    descartadas: r.descartadas,   // variables rechazadas por rango físico
  });
});
