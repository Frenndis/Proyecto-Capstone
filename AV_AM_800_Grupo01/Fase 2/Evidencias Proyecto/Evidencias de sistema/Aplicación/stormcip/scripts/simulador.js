// Simulador de un ciclo CIP contra los EMULADORES. Uso: npm run sim
//
// Modelo v2. La versión anterior enviaba "temperatura", "concentracion",
// "caudal" y "presion": en v2 la primera no existe como variable y las otras
// tres no las provee ninguna sonda de CATALOGO_SONDAS, así que el ingest las
// descartaba todas y respondía 400 "Sin variables válidas". No entraba ni una
// lectura, y sin lecturas el dashboard no mostraba nada.
//
// Recorre las etapas en orden en vez de abrir dos intervalos en paralelo: dos
// equipos escribiendo etapas distintas a la vez hacían que `etapaActual` del
// ciclo oscilara, y el dashboard mostraba una etapa que cambiaba sola.
//
// Uso:
//   npm run sim                       -> ciclo completo, 2 s por lectura
//   node simulador.js --intervalo 1   -> más rápido
//
// Las lecturas se envían con la hora ACTUAL para que el dashboard se mueva en
// vivo. Eso comprime el tiempo: los indicadores del ciclo saldrán con un
// tiempoHastaLimpio de segundos y una pendiente enorme. Para una curva con
// tiempos realistas, usar simulador-prod.js, que fecha las lecturas hacia atrás.

const URL = process.env.INGEST_URL ||
  "http://127.0.0.1:5001/stormcip-dev/southamerica-west1/ingestLectura";
const DEVICE_ID = process.env.DEVICE_ID || "wqs-lb-01";
const API_KEY = process.env.API_KEY || "dev-key-wqs-456";
const CICLO_ID = process.env.CICLO_ID || "CIP-2026-0001";

const arg = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? Number(process.argv[i + 1]) : def;
};
const INTERVALO_MS = arg("intervalo", 2) * 1000;

const ruido = (amp) => (Math.random() - 0.5) * amp;
const ec25 = (ec, t) => ec / (1 + 0.02 * (t - 25));

// Un ciclo CIP real. Las etapas químicas se incluyen para que se vea el aviso
// de "etapa fuera del alcance de monitoreo" en el dashboard, pero sus lecturas
// NO entran a los indicadores: alCerrarCiclo solo considera las monitoreadas.
const ETAPAS = [
  { etapa: "preenjuague",    pasos: 6,  ecIni: 1800, ecFin: 400,  temp: 20, turbIni: 90, turbFin: 25 },
  { etapa: "alcalino",       pasos: 5,  ecIni: 9000, ecFin: 9500, temp: 77, turbIni: 30, turbFin: 20, ph: 12.2 },
  { etapa: "enjuague",       pasos: 10, ecIni: 2400, ecFin: 220,  temp: 40, turbIni: 70, turbFin: 6 },
  { etapa: "acido",          pasos: 5,  ecIni: 6000, ecFin: 6200, temp: 60, turbIni: 25, turbFin: 18, ph: 2.1 },
  { etapa: "enjuague_final", pasos: 8,  ecIni: 1200, ecFin: 180,  temp: 25, turbIni: 40, turbFin: 4 },
];

// Interpola de ini a fin con una caída exponencial (así se comporta un enjuague)
function curva(ini, fin, paso, total) {
  const d = Math.exp(-paso / Math.max(total / 4, 1));
  return fin + (ini - fin) * d;
}

function valoresDe(e, paso) {
  const ec = curva(e.ecIni, e.ecFin, paso, e.pasos) + ruido(30);
  const tempEc = e.temp + ruido(1.5);
  const turbidez = curva(e.turbIni, e.turbFin, paso, e.pasos) + ruido(3);
  // pH: en los enjuagues converge al del agua de red; en las químicas es el de
  // la solución, que es justamente donde la sonda trabaja fuera de rango.
  const ph = e.ph !== undefined
    ? e.ph + ruido(0.15)
    : 7.4 + 2.5 * Math.exp(-paso / Math.max(e.pasos / 3, 1)) + ruido(0.2);

  return {
    conductividad: +Math.max(ec, 1).toFixed(1),
    tempEc: +tempEc.toFixed(1),
    tempExterna: +(tempEc - 2 + ruido(0.5)).toFixed(1),
    ph: +ph.toFixed(2),
    turbidez: +Math.max(turbidez, 0.1).toFixed(1),
  };
}

async function enviar(etapa, valores) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ deviceId: DEVICE_ID, cicloId: CICLO_ID, etapa, valores }),
  });
  return { status: res.status, cuerpo: await res.text() };
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`Simulando ciclo ${CICLO_ID} en ${URL}`);
  console.log(`equipo=${DEVICE_ID}  intervalo=${INTERVALO_MS / 1000}s\n`);

  let ok = 0, fallos = 0;

  for (const e of ETAPAS) {
    const monitoreada = ["preenjuague", "enjuague", "enjuague_final"].includes(e.etapa);
    console.log(`--- ${e.etapa}${monitoreada ? "" : "  (fuera del alcance de monitoreo)"}`);

    for (let paso = 0; paso < e.pasos; paso++) {
      const valores = valoresDe(e, paso);
      try {
        const { status, cuerpo } = await enviar(e.etapa, valores);
        // procesarLectura responde 201 Created, no 200: comparar con 200 exacto
        // hacía que una ingesta correcta se reportara como fallo.
        if (status >= 200 && status < 300) {
          ok++;
          const comp = ec25(valores.conductividad, valores.tempEc);
          console.log(`  ok    EC=${String(valores.conductividad).padStart(7)}  T=${valores.tempEc}°C  EC25=${comp.toFixed(0).padStart(5)}  turb=${valores.turbidez}  pH=${valores.ph}`);
        } else {
          fallos++;
          console.log(`  FALLA ${status} ${cuerpo}`);
          if (status === 401) {
            console.error("\n401: corré el seed primero (npm run seed).");
            process.exit(1);
          }
        }
      } catch (err) {
        fallos++;
        console.error(`  Error de red: ${err.message}`);
        console.error("  ¿Están corriendo los emuladores? firebase emulators:start");
        process.exit(1);
      }
      await espera(INTERVALO_MS);
    }
  }

  console.log(`\n${ok} lecturas aceptadas, ${fallos} rechazadas.`);
  console.log("El ciclo sigue en_curso. Para ver los indicadores, cerralo:");
  console.log(`  node cerrar-ciclo.js ${CICLO_ID}   (con PROJECT_ID y ADC)`);
})();
