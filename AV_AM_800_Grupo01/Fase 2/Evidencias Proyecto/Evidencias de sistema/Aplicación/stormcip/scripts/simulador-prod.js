// Simula un enjuague con lecturas FECHADAS hacia atrás, vía el endpoint HTTP
// de ingesta (ingestLectura / POST /api/ingest).
//
// Destino (guardarraíles en entorno.js):
//   node simulador-prod.js                                    -> emuladores
//                                                                (wqs-lb-01, dev-key-wqs-456)
//   $env:DEVICE_KEY = "<la misma que usaste en seed-prod.js>"
//   node simulador-prod.js --prod --project stormcip-972bd    -> producción (wqs-01)
//   ... --pasos 20 --intervalo 3                              -> 20 lecturas, 3 min entre cada una
//
// Antes iba a producción por defecto (o a INGEST_URL): ya no hay URL
// configurable, el destino lo deciden solo los flags.
//
// La etapa la pone el ciclo (su etapaActual), no este script: las lecturas se
// guardan en la etapa en que esté el ciclo, que se muestra en cada respuesta.
//
// Las lecturas se FECHAN hacia atrás (campo ts, que el ingest acepta en millis)
// para que queden separadas por minutos de proceso aunque el script tarde
// segundos en correr. Sin eso, 15 lecturas a 1 por segundo darían una pendiente
// de miles de µS/cm por minuto y un tiempoHastaLimpio de 14 s: números que no
// se pueden defender en una demo.

const { PROYECTO_PROD, resolverEntorno, anunciar, salir } = require("./entorno");

const entorno = resolverEntorno({ flagsConValor: ["pasos", "intervalo"] });
const URL = entorno.prod
  ? `https://${PROYECTO_PROD}.web.app/api/ingest`
  : `http://127.0.0.1:5001/${entorno.projectId}/southamerica-west1/ingestLectura`;

const DEVICE_KEY = process.env.DEVICE_KEY || (entorno.prod ? undefined : "dev-key-wqs-456");
if (!DEVICE_KEY) salir("Falta DEVICE_KEY. Es la misma que generaste para seed-prod.js.");
if (entorno.prod && DEVICE_KEY.startsWith("dev-key")) {
  salir("Esa es una key de desarrollo; producción no la acepta.");
}

// Dispositivos de seed-prod.js (wqs-01) y seed.js (wqs-lb-01), ambos con el
// equipo comprado: DR-PH01 (ph, tempSonda) y DR-ECK1.0 (conductividad, tempEc).
const DEVICE_ID = process.env.DEVICE_ID || (entorno.prod ? "wqs-01" : "wqs-lb-01");
const CICLO_ID = process.env.CICLO_ID || "CIP-2026-0001";

const numero = (nombre, porDefecto) => {
  const v = entorno.valor(nombre);
  return v === undefined ? porDefecto : Number(v);
};
const PASOS = numero("pasos", 15);
const INTERVALO_MIN = numero("intervalo", 2);

const ruido = (amp) => (Math.random() - 0.5) * amp;

// Curva de enjuague: la conductividad cae exponencialmente desde el arrastre
// de la etapa química hacia la del agua de red (150 µS/cm, según
// configuracion/calculos). El criterio de limpio es 200 µS/cm a 25 °C;
// TAU está elegido para que la curva lo cruce alrededor de dos tercios del
// recorrido, dejando lecturas despues del cruce para que la pendiente quede
// bien definida. EC_INICIAL queda bajo el tope de la DR-ECK1.0 (2000).
const EC_INICIAL = 1800;
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
      ph: +(11.5 - 4 * (1 - d) + ruido(0.2)).toFixed(2),
      tempSonda: +(tempEc - 0.3 + ruido(0.4)).toFixed(1),
    },
  };
}

(async () => {
  anunciar(entorno, URL);
  console.log(`Enviando ${PASOS} lecturas · dispositivo=${DEVICE_ID}  ciclo=${CICLO_ID}`);
  console.log(`separadas ${INTERVALO_MIN} min entre si (${PASOS * INTERVALO_MIN} min de proceso)\n`);

  let ok = 0;
  for (let paso = 0; paso < PASOS; paso++) {
    const { ts, valores } = lectura(paso);
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": DEVICE_KEY },
        body: JSON.stringify({ deviceId: DEVICE_ID, cicloId: CICLO_ID, ts, valores }),
      });
      const cuerpo = await res.text();

      if (res.status === 401) {
        console.error(`\n401: la DEVICE_KEY no coincide con el hash de dispositivos/${DEVICE_ID}.`);
        process.exit(1);
      }
      if (res.status === 404) {
        console.error(`\n404: ${URL} no respondió (¿emuladores apagados, o el ciclo ${CICLO_ID} no existe?).`);
        process.exit(1);
      }
      // procesarLectura responde 201 Created, no 200: comparar con 200 exacto
      // hacía que una ingesta correcta se reportara como fallo.
      const aceptada = res.status >= 200 && res.status < 300;
      if (aceptada) ok++;
      const marca = aceptada ? "ok   " : "FALLA";
      const hora = new Date(ts).toLocaleTimeString("es-CL");
      console.log(`${marca} ${paso + 1}/${PASOS}  ${hora}  EC=${valores.conductividad} µS/cm  T=${valores.tempEc} °C  ${res.status} ${cuerpo}`);
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
  console.log(`  node cerrar-ciclo.js ${CICLO_ID}${entorno.prod ? ` --prod --project ${PROYECTO_PROD}` : ""}`);
})();
