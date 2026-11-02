// Carga 120 días de limpiezas de la planta de demostración: 8 circuitos con sus recetas,
// desvíos del andén 3, sobredosis del pasteurizador y una posible fuga reciente en el
// andén 2. Todo queda marcado como simulado: no demuestra ahorro real.
//
// Uso, desde scripts/ (antes `npm run build` en functions/):
//   node sembrar-planta.js                                 (emuladores)
//   node sembrar-planta.js --prod --project <proyecto>     (producción)
// Los ID son fijos por día y circuito: correrlo de nuevo reescribe los mismos ciclos.
const path = require("path");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { resolverEntorno, inicializarAdmin, salir } = require("./entorno");

const entorno = resolverEntorno();
inicializarAdmin(entorno);
const db = getFirestore();

let motor, ml;
try {
  motor = require(path.join(__dirname, "..", "functions", "lib", "planta", "motor"));
  ml = require(path.join(__dirname, "..", "functions", "lib", "planta", "ml"));
} catch { salir("Falta functions/lib: corre `npm run build` en functions/ antes."); }

const DIA_MS = 86400000;
const DIAS = 120;

(async () => {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const ahora = Date.now();
  let n = 4400, escritos = 0;
  const historia = [];
  let batch = db.batch(), enBatch = 0;

  for (const c of motor.CIRCUITOS) {
    await db.doc(`plantas/demo/lineas/${c.id}`).set({ nombre: c.corto, area: c.area, estado: "activa" });
  }
  await db.doc("plantas/demo").set({ nombre: "Planta demo · Lácteos", cliente: "Demostración" });

  for (let d = DIAS; d >= 0; d--) {
    const dia = new Date(hoy.getTime() - d * DIA_MS);
    for (const c of motor.CIRCUITOS) {
      if (c.libres.includes(dia.getDay())) continue;
      const semilla = d * 100 + motor.CIRCUITOS.indexOf(c) + 1;
      const r = motor.rng(semilla + 5000);
      const minutos = Math.floor(r() * 50);
      const inicioMs = dia.getTime() + c.hora * 3600000 + minutos * 60000;
      const contexto = motor.contextoPara(c, dia, semilla);
      const o = {
        semilla, contexto,
        desvio: r() < (c.id === "and3" && d <= 20 ? Math.max(0.45, motor.probDesvio(c, contexto)) : motor.probDesvio(c, contexto)),
        // Una tina con la soda bajo el mínimo, para que el registro muestre un ciclo retenido
        fuera: c.id === "tina2" && d === 12,
        fugaFinal: c.id === "and2" && d <= 6 ? 1.7 : undefined,
      };
      const duracion = motor.resumir(c, o).duracionS * 1000;
      // Hoy solo existe lo que ya terminó
      if (inicioMs + duracion > ahora) continue;
      const numero = `CIP-${++n}`;
      const { inicioMs: i0, finMs, ...doc } = motor.cicloCerrado(c, o, inicioMs, numero);
      batch.set(db.doc(`ciclos/${numero}`), { ...doc, inicio: Timestamp.fromMillis(i0), fin: Timestamp.fromMillis(finMs) });
      historia.push({ circuitoId: c.id, circuito: c.nombre, inicioMs: i0, resumen: doc.resumen, litrosPorS: doc.litrosPorS, contexto });
      escritos++;
      if (++enBatch === 100) { await batch.commit(); batch = db.batch(); enBatch = 0; }
    }
  }
  if (enBatch) await batch.commit();
  const previo = (await db.doc("configuracion/contador").get()).get("n") ?? 0;
  await db.doc("configuracion/contador").set({ n: Math.max(n, previo) }, { merge: true });
  await db.doc("configuracion/calculos").set({
    conductividadAguaRed: motor.EC_RED, metaAguaDiariaM3: 26,
    criterioLimpio: { conductividad25C: motor.CRITERIO_LIMPIO, turbidez: 10 },
    factorCompensacionEC: 0.02, caudalNominalM3h: 18,
  }, { merge: true });
  const r = ml.analizar(historia, ahora);
  await db.doc("configuracion/oportunidades").set({ ...r, actualizadoEn: Timestamp.now() });
  console.log(`Listo: ${escritos} ciclos · ${r.decisiones.length} decisiones · ${r.predicciones.length} predicciones.`);
  for (const x of r.decisiones.slice(0, 5)) console.log(` - ${x.tipo}: ${x.titulo} · ${x.aguaMesL} L/mes`);
  for (const m of r.ml.metricas) console.log(` · ${m.id}: error ${m.error} vs base ${m.errorBase} (mejora ${Math.round(m.mejora * 100)} %) · R2/acierto ${m.r2} · cobertura ${m.cobertura} · útil ${m.util}`);
  process.exit(0);
})().catch((e) => salir(e.message));
