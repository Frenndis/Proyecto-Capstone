// Simula un webhook de TTN (The Things Stack) hacia ttnUplink. Uso: npm run sim:ttn
// El body y `frm_payload` (base64) siguen el formato real de TTN: ttnUplink ya no
// usa `decoded_payload`, decodifica los bytes crudos con wqsDecoder (ver
// Base de datos/TAREAS-DECODER-WQS.md).
const URL = process.env.TTN_URL ||
  "http://127.0.0.1:5001/stormcip-dev/southamerica-west1/ttnUplink";
const SECRET = process.env.TTN_WEBHOOK_SECRET || "test-secret";

// FPort=2, firmware 1.2, sondas DR-PH01 + DR-ECK10.0 + DR-TS1 (config real del
// proyecto, ver seed.js): turbidez 251.0, EC_K10 10000, ecTemp 27.3, pH 7.00,
// phTemp 27.3. Mismo payload verificado en functions/src/wqsDecoder.test.ts.
const PAYLOAD_VALIDO_HEX = "0CB40CCC2509CE03E8011102BC0111";
// Igual, pero con pH crudo 0x060E = 1550 -> pH 15.5 (fuera de rango físico, >14).
const PAYLOAD_PH_FUERA_DE_RANGO_HEX = "0CB40CCC2509CE03E80111060E0111";

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
  console.log("== 1) Uplink valido (pH, EC_K10, turbidez, firmware 1.2) ==");
  await enviarBody(body(PAYLOAD_VALIDO_HEX));

  console.log("== 2) Uplink con pH fuera de rango fisico (>14) ==");
  await enviarBody(body(PAYLOAD_PH_FUERA_DE_RANGO_HEX));

  console.log("== 3) Uplink de dispositivo desconocido ==");
  const desconocido = body(PAYLOAD_VALIDO_HEX);
  desconocido.end_device_ids.device_id = "device-inexistente";
  await enviarBody(desconocido);

  console.log("== 4) Uplink FPort=5 (debe ignorarse, no se decodifica) ==");
  const est = body(PAYLOAD_VALIDO_HEX);
  est.uplink_message.f_port = 5;
  await enviarBody(est);
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
