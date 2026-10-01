// Simula un enjuague REAL contra producción, vía POST /api/ingest.
//
// Por qué no sirve simulador.js aquí:
//   - usa deviceId "wqs-lb-01" y las keys de desarrollo (dev-key-*), que en
//     producción no existen: seed-prod.js se niega a sembrar una key así;
//   - envía "temperatura", que es del modelo v1. En v2 esa variable no existe
//     (ver VARIABLES en functions/src/types.ts) y el ingest la descarta. Sin
//     una temperatura válida no hay conductividad25C, y sin conductividad25C
//     NINGÚN indicador del ciclo se puede calcular.
//
// Uso (PowerShell, desde scripts\):
//   $env:DEVICE_KEY = "<la misma que usaste en seed-prod.js>"
//   node simulador-prod.js                 -> 15 lecturas, 2 min entre cada una
//   node simulador-prod.js --pasos 20 --intervalo 3
//
// Las lecturas se FECHAN hacia atrás (campo ts, que el ingest acepta en millis)
// para que queden separadas por minutos de proceso aunque el script tarde
// segundos en correr. Sin eso, 15 lecturas a 1 por segundo darían una pendiente
// de miles de µS/cm por minuto y un tiempoHastaLimpio de 14 s: números que no
// se pueden defender en una demo.

const DEVICE_KEY = process.env.DEVICE_KEY;
if (!DEVICE_KEY) {
  console.error("Falta DEVICE_KEY. Es la misma que generaste para seed-prod.js.");
  process.exit(1);
}
if (DEVICE_KEY.startsWith("dev-key")) {
  console.error("Esa es una key de desarrollo; producción no la acepta.");
  process.exit(1);
}

const URL = process.env.INGEST_URL || "https://stormcip-972bd.web.app/api/ingest";
// wqs-01 es el dispositivo que crea seed-prod.js, con las 4 sondas activas:
// DR-PH01 (ph, tempSonda), DR-ECK10.0 (conductividad, tempEc), DR-TS1
// (turbidez) y DS18B20 (tempExterna). El ingest descarta cualquier variable
// que no tenga una sonda activa que la cubra, así que estos nombres importan.
const DEVICE_ID = process.env.DEVICE_ID || "wqs-01";
const CICLO_ID = process.env.CICLO_ID || "CIP-2026-0001";
const ETAPA = process.env.ETAPA || "enjuague";

const arg = (nombre, porDefecto) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 ? Number(process.argv[i + 1]) : porDefecto;
};
const PASOS = arg("pasos", 15);
const INTERVALO_MIN = arg("intervalo", 2);

const ruido = (amp) => (Math.random() - 0.5) * amp;

// Curva de enjuague: la conductividad cae exponencialmente desde el arrastre
// de la etapa química hacia la del agua de red (150 µS/cm, según
// configuracion/calculos). El criterio de limpio es 300 µS/cm a 25 °C y 20 NTU;
// TAU está elegido para que la curva lo cruce alrededor de dos tercios del
// recorrido, dejando lecturas despues del cruce para que la pendiente quede
// bien definida.
const EC_INICIAL = 2400;
const EC_AGUA_RED = 150;
const TAU = PASOS / 4;

// La primera lectura queda PASOS*INTERVALO minutos en el pasado para que la
// última caiga en "ahora".
const T0 = Date.now() - PASOS * INTERVALO_MIN * 60_000;

function lectura(paso) {
  const d = Math.exp(-paso / TAU);
  // La temperatura baja con el enjuague: arrastra agua caliente de la etapa
  // química anterior y converge hacia el agua de red.
  const tempEc = 45 - 20 * (1 - d) + ruido(0.6);
  return {
    ts: T0 + paso * INTERVALO_MIN * 60_000,
    valores: {
      conductividad: +(EC_AGUA_RED + (EC_INICIAL - EC_AGUA_RED) * d + ruido(20)).toFixed(1),
      tempEc: +tempEc.toFixed(1),
      tempExterna: +(tempEc - 2 + ruido(0.4)).toFixed(1),
      ph: +(11.5 - 4 * (1 - d) + ruido(0.2)).toFixed(2),
      turbidez: +(70 * d + 4 + ruido(2)).toFixed(1),
    },
  };
}

(async () => {
  console.log(`Enviando ${PASOS} lecturas a ${URL}`);
  console.log(`dispositivo=${DEVICE_ID}  ciclo=${CICLO_ID}  etapa=${ETAPA}`);
  console.log(`separadas ${INTERVALO_MIN} min entre si (${PASOS * INTERVALO_MIN} min de proceso)\n`);

  let ok = 0;
  for (let paso = 0; paso < PASOS; paso++) {
    const { ts, valores } = lectura(paso);
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": DEVICE_KEY },
        body: JSON.stringify({ deviceId: DEVICE_ID, cicloId: CICLO_ID, etapa: ETAPA, ts, valores }),
      });
      const cuerpo = await res.text();

      if (res.status === 401) {
        console.error(`\n401: la DEVICE_KEY no coincide con el hash de dispositivos/${DEVICE_ID}.`);
        process.exit(1);
      }
      if (res.status === 404) {
        console.error("\n404: revisa que INGEST_URL apunte al proyecto correcto.");
        process.exit(1);
      }
      // procesarLectura responde 201 Created, no 200: comparar con 200 exacto
      // hacía que una ingesta correcta se reportara como fallo.
      const aceptada = res.status >= 200 && res.status < 300;
      if (aceptada) ok++;
      const marca = aceptada ? "ok   " : "FALLA";
      const hora = new Date(ts).toLocaleTimeString("es-CL");
      console.log(`${marca} ${paso + 1}/${PASOS}  ${hora}  EC=${valores.conductividad} µS/cm  T=${valores.tempEc} °C  turb=${valores.turbidez}  ${res.status} ${cuerpo}`);
    } catch (e) {
      console.error(`Error de red en el paso ${paso + 1}:`, e.message);
    }
  }

  console.log(`\n${ok}/${PASOS} lecturas aceptadas.`);
  if (ok === 0) {
    console.log("Ninguna entro: revisa DEVICE_KEY y que dispositivos/" + DEVICE_ID + " tenga sondas activas.");
    process.exit(1);
  }
  console.log("\nEl ciclo sigue en_curso, asi que el dashboard ya muestra las");
  console.log("tarjetas y la tendencia. Los INDICADORES aparecen al cerrarlo:");
  console.log(`  node cerrar-ciclo.js ${CICLO_ID}`);
})();
