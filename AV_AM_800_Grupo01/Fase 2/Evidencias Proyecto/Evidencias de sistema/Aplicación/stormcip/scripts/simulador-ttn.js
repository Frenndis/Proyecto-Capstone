// Simula un webhook de TTN (The Things Stack) hacia ttnUplink. Uso: npm run sim:ttn
// Formato del body y nombres de campo tomados de la documentacion oficial de TTN
// y del decoder Dragino — no verificado contra un uplink real (ver
// Base de datos/modelo-datos-sensores.md, seccion 5).
const URL = process.env.TTN_URL ||
  "http://127.0.0.1:5001/proyectocapstone-1029b/southamerica-west1/ttnUplink";
const SECRET = process.env.TTN_WEBHOOK_SECRET || "test-secret";

const payload = (overrides = {}) => ({
  end_device_ids: { device_id: "wqs-lb-01", dev_eui: "0011223344556677" },
  uplink_message: {
    f_port: 2,
    decoded_payload: {
      BatV: 3.252,
      temp_DS18B20: 327.6, // sin sonda de temperatura externa conectada
      PH: 7.35,
      EC_K10: 850,
      turbidity: 22.4,
      ...overrides,
    },
  },
  received_at: new Date().toISOString(),
});

(async () => {
  console.log("== 1) Uplink valido (ph, EC_K10, turbidity) ==");
  await enviar(payload());

  console.log("== 2) Uplink con pH fuera de rango fisico (>14) ==");
  await enviar(payload({ PH: 15.5 }));

  console.log("== 3) Uplink de dispositivo desconocido ==");
  await enviar(payload({}), "device-inexistente");

  console.log("== 4) Uplink FPort=5 (estado del dispositivo, debe ignorarse) ==");
  const est = payload();
  est.uplink_message.f_port = 5;
  await enviarBody(est);
})();

async function enviar(body, deviceIdOverride) {
  if (deviceIdOverride) body.end_device_ids.device_id = deviceIdOverride;
  await enviarBody(body);
}

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
