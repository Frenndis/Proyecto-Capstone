import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { decodeWqs, bytesToHex, LecturaTiempoReal } from "./wqsDecoder";
import { Variable } from "./types";
import { procesarLectura } from "./ingest";

/**
 * Secreto del webhook, vía Secret Manager (no una env var plana). En local,
 * el emulador lo lee de `functions/.secret.local` (mismo formato CLAVE=valor
 * que un .env); en producción hay que crearlo una vez con
 * `firebase functions:secrets:set TTN_WEBHOOK_SECRET --project <id>` antes
 * del primer deploy (ver DESPLIEGUE.md).
 */
const ttnWebhookSecret = defineSecret("TTN_WEBHOOK_SECRET");

/**
 * Webhook de The Things Stack (TTN) para el WQS-LB.
 *
 * Configurar en TTN: Application > Integrations > Webhooks > Add webhook, con:
 *  - URL: esta función (ver firebase.json rewrites, análogo a /api/ingest)
 *  - Header "x-webhook-secret": el valor del secreto TTN_WEBHOOK_SECRET
 *
 * Convención de aprovisionamiento: el "Device ID" registrado en TTN debe ser
 * idéntico al id del documento dispositivos/{deviceId} en Firestore.
 *
 * Decodifica `uplink_message.frm_payload` (base64) con el decoder propio
 * (wqsDecoder.ts). NO usa `uplink_message.decoded_payload`: ese payload lo
 * genera el decoder oficial de Dragino en GitHub, que corresponde a firmware
 * 1.1 o anteriores (ver Base de datos/TAREAS-DECODER-WQS.md).
 *
 * Solo procesa FPort=2 (lectura en tiempo real); FPort 3 (datalog) y 5 (estado)
 * se ignoran, igual que antes.
 */
export const ttnUplink = onRequest({ secrets: [ttnWebhookSecret] }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Usar POST"); return; }

  const secretEsperado = ttnWebhookSecret.value();
  if (!secretEsperado || req.get("x-webhook-secret") !== secretEsperado) {
    res.status(401).json({ error: "Secreto de webhook inválido o no configurado" });
    return;
  }

  const body = req.body ?? {};
  const deviceId: string | undefined = body?.end_device_ids?.device_id;
  const devEui: string | undefined = body?.end_device_ids?.dev_eui;
  const fPort = body?.uplink_message?.f_port;
  const frmPayload: string | undefined = body?.uplink_message?.frm_payload;
  const receivedAt: string | undefined = body?.received_at;

  if (!deviceId || !devEui || fPort !== 2 || !frmPayload) {
    res.status(200).json({ ok: true, ignorado: true, motivo: "sin frm_payload, dev_eui o fport != 2" });
    return;
  }

  const db = getFirestore();
  const devRef = db.doc(`dispositivos/${deviceId}`);
  const dev = await devRef.get();
  if (!dev.exists) {
    res.status(200).json({ ok: true, ignorado: true, motivo: "dispositivo desconocido" });
    return;
  }

  const bytes = Buffer.from(frmPayload, "base64");
  // Si el dispositivo no tiene firmware registrado, se pasa `undefined` y el
  // decoder infiere el formato por el largo del payload (wqsDecoder.ts).
  const firmware = dev.get("firmware") as string | undefined;
  const resultado = decodeWqs(bytes, fPort, firmware);
  if (!resultado.ok) {
    // Necesario para depurar el primer uplink real contra un payload de campo.
    console.warn("ttnUplink: wqsDecoder no pudo decodificar el payload", {
      deviceId, fPort, error: resultado.error, hex: resultado.raw.hex,
    });
    res.status(200).json({ ok: true, ignorado: true, motivo: resultado.error });
    return;
  }
  if (resultado.fPort !== 2) {
    // No debería pasar: ya filtramos fPort===2 más arriba antes de decodificar.
    res.status(200).json({ ok: true, ignorado: true, motivo: "fPort inesperado tras decodificar" });
    return;
  }

  // Sin received_at válido no hay forma de armar un lecturaId determinista
  // ({devEui}_{tsSegundos}): si se cae a NaN, todas las lecturas de ese
  // dispositivo colisionarían en el mismo ID y se sobrescribirían entre sí.
  // Se ignora en vez de usar la hora del servidor como respaldo.
  const tsMs = receivedAt ? Date.parse(receivedAt) : NaN;
  if (Number.isNaN(tsMs)) {
    console.warn("ttnUplink: received_at ausente o no parseable", { deviceId, receivedAt });
    res.status(200).json({ ok: true, ignorado: true, motivo: "received_at ausente o no parseable" });
    return;
  }

  const lineaId = dev.get("lineaId");
  const ciclo = await resolverCicloActivo(db, lineaId);
  if (!ciclo) {
    res.status(200).json({ ok: true, ignorado: true, motivo: "sin ciclo en curso en la línea" });
    return;
  }

  const valoresCrudos = mapearAValores(resultado.datos);

  const respuesta = await procesarLectura({
    dev, devRef, cicloId: ciclo.cicloId, etapa: ciclo.etapa, valoresCrudos,
    ts: tsMs,
    lecturaId: `${devEui}_${Math.floor(tsMs / 1000)}`,
    extra: { hex: bytesToHex(bytes), bateriaV: resultado.datos.bateriaV },
  });

  // Igual que los demás "ignorados" de arriba: un rechazo de negocio (tipo o
  // rango físico) no debe hacer que TTN reintente en loop. Se responde 200 con
  // un log en vez de propagar el 400/404 de procesarLectura.
  if (respuesta.status >= 400) {
    console.warn("ttnUplink: procesarLectura rechazó la lectura", {
      deviceId, status: respuesta.status, body: respuesta.body,
    });
    res.status(200).json({ ok: true, ignorado: true, motivo: respuesta.body.error });
    return;
  }
  res.status(respuesta.status).json(respuesta.body);
});

// Mapeo fijo para la configuración de sondas de este proyecto: DR-PH01,
// DR-ECK10.0, DR-TS1 y el DS18B20 externo (ver seed.js). `phTemp` se guarda
// como la Variable genérica "temperatura" (la que usan los umbrales y el
// dashboard); `ecTemp` y `tempExterna` son variables propias. No es un mapeo
// genérico de todos los campos que wqsDecoder puede producir (ORP, DO, EC_K1,
// formatoInferido no aplican a esta configuración y se ignoran a propósito).
const CAMPO_A_VARIABLE: Partial<Record<keyof LecturaTiempoReal, Variable>> = {
  ph: "ph",
  phTemp: "temperatura",
  turbidez: "turbidez",
  ecK10: "conductividad",
  ecK10Temp: "ecTemp",
  tempExterna: "tempExterna",
};

function mapearAValores(datos: LecturaTiempoReal): Record<string, unknown> {
  const valores: Record<string, unknown> = {};
  for (const [campo, variable] of Object.entries(CAMPO_A_VARIABLE)) {
    const valor = (datos as Record<string, unknown>)[campo];
    if (valor === undefined) continue;
    valores[variable] = valor;
  }
  return valores;
}

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
