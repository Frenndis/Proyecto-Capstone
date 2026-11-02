// Motor de la planta de demostración: circuitos, recetas y simulador determinista
// de un ciclo CIP. Recetas tomadas de la maqueta Storm CIP de Austral. Lo usan la
// demo en vivo, la siembra de historia y las pruebas. Sin Firestore.
import type { Etapa } from "../types";

export type Fase = {
  n: string; etapa: Etapa; s: number; t: number; c: number; q: number;
  chem: number; fresh: number; min: number | null; enjuague: boolean;
};
export type Circuito = {
  id: string; nombre: string; corto: string; area: string; receta: string; lead: string;
  fases: Fase[];
  /** Fracción de cada enjuague en que el agua ya queda limpia en este circuito. */
  fraccionLimpio: number;
  /** Probabilidad de desvío de temperatura en la soda. */
  pDesvio: number;
  /** Concentración real sobre la receta (1 = exacta). */
  sobredosis: number;
  /** Hora del día en que normalmente se limpia. */
  hora: number;
  /** Días de la semana sin ciclo programado (0 = domingo). */
  libres: number[];
};

const ETAPA: Record<string, Etapa> = {
  Preenjuague: "preenjuague", Soda: "alcalino", Monofase: "alcalino", Enjuague: "enjuague",
  "Ácido": "acido", "Enjuague final": "enjuague_final", Drenaje: "desinfeccion",
};

function fase(n: string, min: number, t: number, c = 0, minT: number | null = null, q?: number): Fase {
  const base = n === "Drenaje" ? 4 : c > 0 ? 26 : 24;
  return {
    n, etapa: ETAPA[n], s: Math.round(min * 60), t, c, q: q ?? base,
    chem: +(c * 1.5).toFixed(2), fresh: n === "Drenaje" ? 0 : c > 0 ? 0.1 : 0.45, min: minT,
    enjuague: n === "Enjuague" || n === "Enjuague final",
  };
}

/** Ajusta el agua de cada fase para que el ciclo consuma lo que indica su receta. */
function conAgua(fases: Fase[], litros: number): Fase[] {
  const actual = fases.reduce((a, f) => a + (f.q * 1000 / 3600) * f.s * f.fresh, 0);
  return fases.map((f) => ({ ...f, fresh: +(f.fresh * litros / actual).toFixed(4) }));
}

const dosFases = (s: [number, number, number, number, number, number], c1: number, c2: number, t1: number, t2: number, q = 26) => [
  fase("Preenjuague", s[0], 35),
  fase("Soda", s[1], t1, c1, t1 - 5, q),
  fase("Enjuague", s[2], 45),
  fase("Ácido", s[3], t2, c2, t2 - 5, q),
  fase("Enjuague final", s[4], 30),
  fase("Drenaje", s[5], 25),
];

const camion = dosFases([3.33, 7.5, 1.67, 5, 2.5, 1.67], 1.3, 0.6, 70, 70);

export const CIRCUITOS: Circuito[] = [
  {
    id: "and1", nombre: "Camión recolección · andén 1", corto: "Andén 1", area: "Recepción de leche",
    receta: "Camión monofase", lead: "Soda y ácido en una sola etapa",
    fases: conAgua([fase("Preenjuague", 1, 35), fase("Monofase", 4, 60, 0.3, 55), fase("Enjuague", 2, 35)], 820),
    fraccionLimpio: 0.72, pDesvio: 0.02, sobredosis: 1, hora: 6, libres: [],
  },
  {
    id: "and2", nombre: "Camión interplanta · andén 2", corto: "Andén 2", area: "Recepción de leche",
    receta: "Camión 2 fases", lead: "Soda 1,3 % y ácido 0,6 % a 70 °C",
    fases: conAgua(camion, 2080), fraccionLimpio: 0.62, pDesvio: 0.03, sobredosis: 1, hora: 7, libres: [],
  },
  {
    id: "and3", nombre: "Camión interplanta · andén 3", corto: "Andén 3", area: "Recepción de leche",
    receta: "Camión 2 fases", lead: "Soda 1,3 % y ácido 0,6 % a 70 °C",
    fases: conAgua(camion, 2080), fraccionLimpio: 0.9, pDesvio: 0.34, sobredosis: 1, hora: 8, libres: [],
  },
  {
    id: "silo3", nombre: "Silo 3", corto: "Silo 3", area: "Silos",
    receta: "Silo 2 fases", lead: "Con bola de aspersión",
    fases: conAgua(dosFases([8, 20, 6, 10, 5, 0], 1, 0.6, 70, 65, 28).filter((f) => f.s > 0), 5200),
    fraccionLimpio: 0.58, pDesvio: 0.02, sobredosis: 1, hora: 6, libres: [0],
  },
  {
    id: "past", nombre: "Pasteurizador", corto: "Pasteurizador", area: "Pasteurización",
    receta: "Pasteurizador 2 fases", lead: "Soda 1,5 % a 80 °C por incrustación de proteína",
    fases: conAgua(dosFases([6, 18, 5, 6, 5, 0], 1.5, 0.8, 80, 65, 30).filter((f) => f.s > 0), 5920),
    fraccionLimpio: 0.66, pDesvio: 0.02, sobredosis: 1.09, hora: 7, libres: [],
  },
  {
    id: "tina2", nombre: "Tina 2 · quesería", corto: "Tina 2", area: "Quesería",
    receta: "Quesería", lead: "Ciclo entre lotes",
    fases: conAgua(dosFases([5, 12, 4, 4, 4, 0], 1, 0.5, 75, 65, 18).filter((f) => f.s > 0), 1420),
    fraccionLimpio: 0.7, pDesvio: 0.02, sobredosis: 1, hora: 10, libres: [0],
  },
  {
    id: "lle1", nombre: "Llenadora 1", corto: "Llenadora 1", area: "Envasado",
    receta: "Llenadora", lead: "Boquillas y tolva",
    fases: conAgua(dosFases([6, 18, 6, 6, 5, 0], 1, 0.5, 75, 65, 20).filter((f) => f.s > 0), 1650),
    fraccionLimpio: 0.55, pDesvio: 0.01, sobredosis: 1, hora: 9, libres: [0],
  },
  {
    id: "lle2", nombre: "Llenadora 2", corto: "Llenadora 2", area: "Envasado",
    receta: "Llenadora", lead: "Boquillas y tolva",
    fases: conAgua(dosFases([6, 18, 6, 6, 5, 0], 1, 0.5, 75, 65, 20).filter((f) => f.s > 0), 1650),
    fraccionLimpio: 0.6, pDesvio: 0.01, sobredosis: 1, hora: 11, libres: [0, 6],
  },
];

export const circuitoPorId = (id: string) => CIRCUITOS.find((c) => c.id === id);

/** Pseudoaleatorio determinista: la misma semilla da el mismo ciclo. */
export function rng(semilla: number) {
  let a = (semilla * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const EC_RED = 150;
export const CRITERIO_LIMPIO = 200;
/** Conductividad de la solución química por cada 1 %. */
const EC_POR_PCT = 50000;
const EXTENSION_S = 120;

/** Condiciones de un ciclo: lo que el modelo ve antes de que empiece. */
export type Contexto = {
  horasDesdeUltima: number;
  /** Producto procesado desde la última limpieza, relativo a lo normal (1 = normal). */
  carga: number;
  tempAgua: number;
  /** Equipos usando vapor al mismo tiempo. */
  activos: number;
  diaSemana: number;
  hora: number;
};

/** Condiciones de planta de un día: la estación, la semana y el azar de la operación. */
export function contextoPara(c: Circuito, fecha: Date, semilla: number): Contexto {
  const r = rng(semilla + 777);
  const dia = fecha.getDay();
  const anio = (fecha.getTime() - Date.UTC(fecha.getFullYear(), 0, 1)) / 86400000;
  const horas = dia === 1 ? 44 + r() * 8 : 20 + r() * 8;
  return {
    horasDesdeUltima: +horas.toFixed(1),
    carga: +Math.max(0.6, Math.min(1.5, (dia === 1 ? 1.15 : 1) + (r() - 0.5) * 0.7)).toFixed(3),
    tempAgua: +(13 + 3.5 * Math.cos((anio / 365) * 2 * Math.PI) + (r() - 0.5) * 2).toFixed(1),
    activos: 1 + Math.floor(r() * 3),
    diaSemana: dia,
    hora: c.hora,
  };
}

/** Falta vapor si hay más equipos activos, y el agua fría exige más. */
export const probDesvio = (c: Circuito, x: Contexto) =>
  Math.min(0.9, c.pDesvio * (0.4 + 0.8 * (x.activos - 1)) * (1 + 0.08 * (14 - x.tempAgua)));

export type Opciones = {
  semilla: number;
  contexto?: Contexto;
  /** Temperatura cae en la soda y la fase se extiende 2 min. */
  desvio?: boolean;
  /** La soda nunca llega a su mínimo. */
  fuera?: boolean;
  /** Agua extra del enjuague final (1,18 = 18 % sobre la receta). */
  fugaFinal?: number;
};

export type Muestra = {
  t: number; i: number; dentro: number; temp: number; conc: number; caudal: number;
  ec: number; agua: number; quim: number; enDesvio: boolean; corregido: boolean;
};

export function crearSimulador(c: Circuito, o: Opciones) {
  const { fases } = c;
  const r = rng(o.semilla);
  const iSoda = fases.findIndex((f) => f.c >= 0.3);
  const durDe = (i: number) => fases[i].s + (o.desvio && i === iSoda ? EXTENSION_S : 0);
  const inicioDe = (i: number) => { let a = 0; for (let k = 0; k < i; k++) a += durDe(k); return a; };
  const dur = inicioDe(fases.length);
  const faseEn = (t: number) => { let a = 0; for (let i = 0; i < fases.length; i++) { a += durDe(i); if (t < a) return i; } return fases.length - 1; };
  // Este ciclo limpia un poco antes o después que su promedio
  // Más producto, más horas sin limpiar o agua más fría: el enjuague tarda más
  const x = o.contexto;
  const efecto = x ? 1 + 0.28 * (x.carga - 1) + 0.0035 * (x.horasDesdeUltima - 24) - 0.012 * (x.tempAgua - 13) : 1;
  const fraccion = Math.min(0.97, c.fraccionLimpio * efecto * (0.97 + r() * 0.06));
  const efectoQuim = x ? 1 + 0.3 * (x.carga - 1) : 1;
  const ruidoEc = () => 1 + (r() - 0.5) * 0.03;
  const ruido15 = ruidoEc();
  const inicioDesvio = fases[iSoda] ? fases[iSoda].s * 0.5 : 0;
  const finDesvio = inicioDesvio + 70;
  const sesgo = r() * 1000;
  const agua1 = (0.985 + r() * 0.03) * (x ? 1 + 0.1 * (x.carga - 1) : 1);

  function en(tIn: number): Muestra {
    const t = Math.max(0, Math.min(tIn, dur - 0.01));
    const i = faseEn(t), f = fases[i], dentro = t - inicioDe(i);
    const previa = i === 0 ? 18 : fases[i - 1].t;
    let temp = f.t + (previa - f.t) * Math.exp(-dentro / 45);
    const hayDesvio = !!o.desvio && i === iSoda && dentro > inicioDesvio && dentro < finDesvio;
    if (hayDesvio) temp -= 9 * Math.sin(((dentro - inicioDesvio) / 70) * Math.PI);
    if (o.fuera && i === iSoda) temp -= 7;
    temp += Math.sin((t + sesgo) / 7) * 0.35;

    const objetivo = f.c * (f.c > 0 ? c.sobredosis : 1);
    const previaC = i === 0 ? 0 : fases[i - 1].c * c.sobredosis;
    const conc = Math.max(0, objetivo + (previaC - objetivo) * Math.exp(-dentro / 28) +
      Math.sin((t + sesgo) / 5) * 0.012 * (f.c > 0.1 ? 1 : 0));
    const caudal = Math.max(0, f.q + Math.sin(t / 3.3) * 0.6 + (dentro < 12 ? -f.q * (1 - dentro / 12) : 0));

    // Conductividad de retorno: en los enjuagues cae hacia la del agua de red
    let ec: number;
    if (f.enjuague) {
      const a = 2000;
      const tau = (fraccion * durDe(i)) / Math.log(a / (CRITERIO_LIMPIO - EC_RED));
      ec = EC_RED + a * Math.exp(-dentro / tau);
    } else if (f.c > 0) ec = conc * EC_POR_PCT;
    else ec = EC_RED + 800 * Math.exp(-dentro / 60);

    let agua = 0, quim = 0;
    for (let k = 0; k <= i; k++) {
      const d = k < i ? durDe(k) : dentro;
      const fuga = o.fugaFinal && fases[k].n === "Enjuague final" ? o.fugaFinal : 1;
      agua += (fases[k].q * 1000 / 3600) * d * fases[k].fresh * fuga * agua1;
      quim += (fases[k].chem * c.sobredosis * efectoQuim / 60) * d;
    }
    return {
      t, i, dentro, temp, conc, caudal, ec, agua, quim,
      enDesvio: hayDesvio && f.min !== null && temp < f.min,
      corregido: !!o.desvio && i === iSoda && dentro >= finDesvio,
    };
  }
  return { en, dur, durDe, inicioDe, iSoda, ruido15 };
}

export type PuntoCurva = { t: number; T: number; c: number; q: number; ec: number; a: number; k: number };
export const puntoDe = (m: Muestra): PuntoCurva => ({
  t: Math.round(m.t), T: +m.temp.toFixed(1), c: +m.conc.toFixed(3), q: +m.caudal.toFixed(1),
  ec: Math.round(m.ec), a: Math.round(m.agua), k: +m.quim.toFixed(1),
});

export type ResumenFase = {
  n: string; objetivoT: number; objetivoC: number; durS: number; tMin: number | null;
  concMedia: number | null; limpioS: number | null; estado: "cumple" | "corregido" | "fuera";
  /** Solo enjuagues: conductividad medida al 15 % de la fase. La usa el modelo en vivo. */
  ec15?: number;
};
export type Resumen = {
  duracionS: number; aguaL: number; quimicoL: number; tempMinSoda: number | null;
  validacion: "validado" | "desvio" | "fuera"; fases: ResumenFase[];
};

/** Lo que queda del ciclo al cerrarlo: cumplimiento por fase y consumos. */
export function resumir(c: Circuito, o: Opciones): Resumen {
  const sim = crearSimulador(c, o);
  const fases: ResumenFase[] = c.fases.map((f, i) => {
    const a = sim.inicioDe(i), d = sim.durDe(i);
    // El mínimo cuenta cuando la fase ya calentó el circuito, no durante la subida
    const espera = f.min ? Math.min(150, d * 0.4) : 0;
    let tMin = Infinity, sumaC = 0, n = 0, limpioS: number | null = null;
    for (let t = 0; t < d; t += 2) {
      const m = sim.en(a + t);
      if (t >= espera) { tMin = Math.min(tMin, m.temp); sumaC += m.conc; n++; }
      if (f.enjuague && limpioS === null && m.ec <= CRITERIO_LIMPIO) limpioS = t;
    }
    const bajo = f.min !== null && tMin < f.min;
    const estado: ResumenFase["estado"] = !bajo ? "cumple" : o.desvio && i === sim.iSoda ? "corregido" : "fuera";
    return {
      n: f.n, objetivoT: f.t, objetivoC: f.c, durS: d,
      tMin: f.min ? +tMin.toFixed(1) : null,
      concMedia: f.c > 0.1 ? +(sumaC / n).toFixed(3) : null, limpioS, estado,
      ...(f.enjuague ? { ec15: Math.round(sim.en(a + d * 0.15).ec * sim.ruido15) } : {}),
    };
  });
  const fin = sim.en(sim.dur);
  const enjuagues = fases.filter((f) => c.fases.find((x) => x.n === f.n)?.enjuague);
  const sinLimpiar = enjuagues.some((f) => f.limpioS === null);
  return {
    duracionS: sim.dur, aguaL: Math.round(fin.agua), quimicoL: +fin.quim.toFixed(1),
    tempMinSoda: fases[sim.iSoda]?.tMin ?? null,
    validacion: fases.some((f) => f.estado === "fuera") || sinLimpiar ? "fuera"
      : fases.some((f) => f.estado === "corregido") ? "desvio" : "validado",
    fases,
  };
}

/** Curva completa con `n` puntos, para un ciclo ya terminado. */
export function curvaCompleta(c: Circuito, o: Opciones, n = 90): PuntoCurva[] {
  const sim = crearSimulador(c, o);
  const out: PuntoCurva[] = [];
  for (let i = 0; i <= n; i++) out.push(puntoDe(sim.en((sim.dur * i) / n)));
  return out;
}

/** Fases tal como se guardan en el ciclo, con la duración real de este ciclo. */
export function fasesDelCiclo(c: Circuito, o: Opciones) {
  const sim = crearSimulador(c, o);
  return c.fases.map((f, i) => ({
    n: f.n, etapa: f.etapa, s: sim.durDe(i), sReceta: f.s, t: f.t, c: f.c, q: f.q, min: f.min, enjuague: f.enjuague,
  }));
}

/** Litros de agua de red por segundo en cada fase: traduce segundos ahorrados a litros. */
export const litrosPorSDe = (c: Circuito) =>
  Object.fromEntries(c.fases.map((f) => [f.n, (f.q * 1000 / 3600) * f.fresh]));

/** Documento completo de un ciclo ya cerrado. Lo usan la siembra y el trigger horario. */
export function cicloCerrado(c: Circuito, o: Opciones, inicioMs: number, numero: string) {
  const r = resumir(c, o);
  return {
    v: 3, numero, plantaId: "demo", lineaId: c.id, circuitoId: c.id, circuito: c.nombre, area: c.area,
    programa: c.receta, recetaVersion: "v3", lead: c.lead, operador: inicioMs % 2 ? "Turno A · Central CIP" : "Turno B · Central CIP",
    estado: "finalizado", etapaActual: c.fases[c.fases.length - 1].etapa,
    fases: fasesDelCiclo(c, o), curva: curvaCompleta(c, o), resumen: r, litrosPorS: litrosPorSDe(c),
    inicioMs, finMs: inicioMs + r.duracionS * 1000,
    consumos: { aguaTotal: +(r.aguaL / 1000).toFixed(3), aguaRecuperada: 0, soda: 0, acido: 0 },
    simulado: true, demo: true, ...(o.contexto ? { contexto: o.contexto } : {}),
  };
}
