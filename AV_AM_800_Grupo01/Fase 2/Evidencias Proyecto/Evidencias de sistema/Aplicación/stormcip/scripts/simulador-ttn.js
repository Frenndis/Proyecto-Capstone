// Simula un webhook de TTN (The Things Stack) hacia ttnUplink. Uso: npm run sim:ttn
// El body y `frm_payload` (base64) siguen el formato real de TTN: ttnUplink ya no
// usa `decoded_payload`, decodifica los bytes crudos con wqsDecoder (ver
// Base de datos/TAREAS-DECODER-WQS.md).
// Solo emuladores: un TTN_URL que no sea local se rechaza (ver DESPLIEGUE.md).
const { PROJECT_ID } = require("./config");
const URL = process.env.TTN_URL ||
  `http://127.0.0.1:5001/${PROJECT_ID}/southamerica-west1/ttnUplink`;
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL)) {
  console.error(`simulador-ttn.js es solo para emuladores y TTN_URL apunta a ${URL}.`);
  process.exit(1);
}
const SECRET = process.env.TTN_WEBHOOK_SECRET || "test-secret";

// FPort=2, firmware 1.2, sondas del equipo comprado DR-PH01 + DR-ECK1.0 (ver
// seed.js), DS18B20 desconectado: EC_K1 1450 µS/cm (sin divisor), ecTemp 27.3,
// pH 7.00, phTemp 27.3. Generado con functions/src/wqsEncoder.ts.
const PAYLOAD_VALIDO_HEX = "0CB40CCC0305AA011102BC0111";
// Igual, pero con pH crudo 0x060E = 1550 -> pH 15.5. El pH no satura (14 es el
// límite de la escala): se descarta como falla de sensor, con el motivo en
// `descartadas`, y el resto de la lectura se guarda.
const PAYLOAD_PH_FUERA_DE_RANGO_HEX = "0CB40CCC0305AA0111060E0111";
// received_at fijo para el caso 5 (idempotencia): con timestamp real (Date.now())
// cada corrida caería en un segundo distinto y generaría un lecturaId distinto,
// lo que no probaría nada sobre reintentos de TTN.
const RECEIVED_AT_FIJO = "2026-09-26T12:00:00.000Z";

function frmPayload(hex) {
  return Buffer.from(hex, "hex").toString("base64");
}

const body = (frmHex, overrides = {}) => ({
  end_device_ids: { device_id: "wqs-lb-01", dev_eui: "0011223344556677" },
  uplink_message: { f_port: 2, frm_payload: frmPayload(frmHex) },
  received_at: new Date().toISOString(),
  ...overrides,
});

(async () => {
  console.log("== 1) Uplink valido (pH, EC_K1, firmware 1.2) ==");
  await enviarBody(body(PAYLOAD_VALIDO_HEX));

  console.log("== 2) Uplink con pH sobre la escala (>14): se descarta solo el pH ==");
  await enviarBody(body(PAYLOAD_PH_FUERA_DE_RANGO_HEX));

  console.log("== 3) Uplink de dispositivo desconocido ==");
  const desconocido = body(PAYLOAD_VALIDO_HEX);
  desconocido.end_device_ids.device_id = "device-inexistente";
  await enviarBody(desconocido);

  console.log("== 4) Uplink FPort=5 (debe ignorarse, no se decodifica) ==");
  const est = body(PAYLOAD_VALIDO_HEX);
  est.uplink_message.f_port = 5;
  await enviarBody(est);

  console.log("== 5) Idempotencia: mismo payload + mismo received_at, dos veces ==");
  console.log("(si el ciclo activo tiene alertas configuradas para la etapa actual,");
  console.log(" revisar en la Emulator UI que 'lecturas' y 'alertas' no queden duplicadas)");
  const retry = body(PAYLOAD_VALIDO_HEX, { received_at: RECEIVED_AT_FIJO });
  console.log("-- primer envio --");
  await enviarBody(retry);
  console.log("-- reenvio (mismo body): deberia pisar la misma lectura/alertas, no duplicar --");
  await enviarBody(retry);
})();

async function enviarBody(body) {
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": SECRET },
      body: JSON.stringify(body),
    });
    console.log(res.status, await res.text());
  } catch (e) { console.error("Error:", e.message); }
}
