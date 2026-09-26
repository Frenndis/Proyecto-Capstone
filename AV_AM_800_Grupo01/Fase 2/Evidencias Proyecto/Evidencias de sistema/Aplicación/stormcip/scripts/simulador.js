// Envía lecturas simuladas de etapa alcalina cada 2 s. Uso: npm run sim
// En producción: INGEST_URL=https://<proyecto>.web.app/api/ingest
const URL = process.env.INGEST_URL ||
  "http://127.0.0.1:5001/stormcip-dev/southamerica-west1/ingestLectura";
const r = (base, amp) => +(base + (Math.random() - 0.5) * amp).toFixed(2);

setInterval(async () => {
  const valores = {
    temperatura: r(77.5, 4), concentracion: r(1.6, 0.6), caudal: r(18, 3),
    presion: r(2.5, 0.8), ph: r(12.2, 0.4), conductividad: r(77, 4),
    turbidez: Math.random() < 0.1 ? r(50, 10) : r(15, 8), // 10% fuera de rango
  };
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "dev-key-123" },
      body: JSON.stringify({ deviceId: "esp32-01", cicloId: "CIP-2026-0001", etapa: "alcalino", valores }),
    });
    console.log(res.status, await res.text());
  } catch (e) { console.error("Error:", e.message); }
}, 2000);

// Unidad WQS-LB (sondas DR-PH01, DR-EC200, DR-TS200) cada 3 s.
setInterval(async () => {
  const valores = {
    ph: Math.random() < 0.1 ? 15.2 : r(7.5, 1), // 10% fuera de rango físico → ingest debe rechazar (400)
    temperatura: r(22, 2),
    conductividad: r(500, 50),
    turbidez: r(20, 5),
  };
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "dev-key-wqs-456" },
      body: JSON.stringify({ deviceId: "wqs-lb-01", cicloId: "CIP-2026-0001", etapa: "enjuague", valores }),
    });
    console.log("[WQS]", res.status, await res.text());
  } catch (e) { console.error("Error WQS:", e.message); }
}, 3000);
