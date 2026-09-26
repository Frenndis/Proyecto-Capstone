import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { BIT_SONDA_LORAWAN, Variable } from "./types";
import { procesarLectura } from "./ingest";

/**
 * Webhook de The Things Stack (TTN) para el WQS-LB.
 *
 * Configurar en TTN: Application > Integrations > Webhooks > Add webhook, con:
 *  - URL: esta función (ver firebase.json rewrites, análogo a /api/ingest)
 *  - Header "x-webhook-secret": el valor de la env var TTN_WEBHOOK_SECRET
 *
 * Convención de aprovisionamiento: el "Device ID" registrado en TTN debe ser
 * idéntico al id del documento dispositivos/{deviceId} en Firestore.
 *
 * Nombres de campo del payload decodificado tomados del decoder oficial Dragino
 * (github.com/dragino/dragino-end-node-decoder, WQS-LB_TTN_Decoder.txt):
 * BatV, temp_DS18B20, PH, ORP, EC_K1, EC_K10, dissolved_oxygen, turbidity.
 *
 * ⚠️ No verificado contra un payload real de TTN — no hay cuenta/gateway todavía
 * (ver Base de datos/modelo-datos-sensores.md, sección 5). Confirmar los nombres
 * de campo apenas se tenga acceso a un uplink real antes de usar en producción.
 */
export const ttnUplink = onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Usar POST"); return; }

  const secretEsperado = process.env.TTN_WEBHOOK_SECRET;
  if (!secretEsperado || req.get("x-webhook-secret") !== secretEsperado) {
    res.status(401).json({ error: "Secreto de webhook inválido o no configurado" });
    return;
  }

  const body = req.body ?? {};
  const deviceId: string | undefined = body?.end_device_ids?.device_id;
  const decoded = body?.uplink_message?.decoded_payload;
  const fPort = body?.uplink_message?.f_port;

  // Solo FPort=2 trae lecturas en tiempo real; FPort=3 (datalog) y 5 (estado) se ignoran por ahora.
  if (!deviceId || !decoded || fPort !== 2) {
    res.status(200).json({ ok: true, ignorado: true, motivo: "sin payload decodificado o fport != 2" });
    return;
  }

  const db = getFirestore();
  const devRef = db.doc(`dispositivos/${deviceId}`);
  const dev = await devRef.get();
  if (!dev.exists) {
    res.status(200).json({ ok: true, ignorado: true, motivo: "dispositivo desconocido" });
    return;
  }

  const lineaId = dev.get("lineaId");
  const ciclo = await resolverCicloActivo(db, lineaId);
  if (!ciclo) {
    res.status(200).json({ ok: true, ignorado: true, motivo: "sin ciclo en curso en la línea" });
    return;
  }

  const valoresCrudos: Partial<Record<Variable, number>> = {};
  for (const { campoDecoder, variable } of BIT_SONDA_LORAWAN) {
    const valor = decoded[campoDecoder];
    if (typeof valor === "number") valoresCrudos[variable] = valor;
  }
  // 327.60°C es el valor "sonda DS18B20 no conectada" según el decoder oficial.
  if (typeof decoded.temp_DS18B20 === "number" && decoded.temp_DS18B20 < 300) {
    valoresCrudos.temperatura = decoded.temp_DS18B20;
  }

  const resultado = await procesarLectura({
    dev, devRef, cicloId: ciclo.cicloId, etapa: ciclo.etapa, valoresCrudos,
  });
  res.status(resultado.status).json(resultado.body);
});

/**
 * El sensor no conoce el ciclo CIP (ver diseño, sección 5.4): se resuelve buscando
 * el ciclo "en_curso" de la línea del dispositivo, y se usa su etapaActual.
 */
async function resolverCicloActivo(db: FirebaseFirestore.Firestore, lineaId: string) {
  const snap = await db.collection("ciclos")
    .where("lineaId", "==", lineaId)
    .where("estado", "==", "en_curso")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { cicloId: doc.id, etapa: doc.get("etapaActual") as string };
}
