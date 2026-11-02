// Motor de decisiones: convierte la historia de ciclos en acciones concretas, cada
// una con cuánto ahorra, qué tan segura es y por qué. Función pura, sin Firestore.
//  · acortar_enjuague: el agua ya queda limpia antes del fin de la fase.
//  · ajustar_dosis: la concentración real está sobre la receta.
//  · revisar_circuito: desvíos de temperatura repetidos. Bloquea acortar.
//  · posible_fuga: el circuito usa más agua que su historia, con igual duración.
// También predice el consumo del próximo ciclo de cada circuito.
import type { Resumen } from "./motor";

export const CONFIG_DECISIONES = {
  minCiclos: 30,
  margen: 0.1,
  fraccionMinima: 0.5,
  fraccionPaso: 0.1,
  maxTasaSinLimpiar: 0.05,
  /** Bajo este ahorro por ciclo no vale la pena cambiar la receta. */
  minAhorroL: 20,
  sobredosisMin: 1.04,
  tasaDesvio: 0.15,
  diasRecientes: 14,
  diasFuga: 6,
  excesoFuga: 1.1,
};

export type CicloDecision = {
  circuitoId: string; circuito: string; inicioMs: number; resumen: Resumen;
  /** Fases con caudal y fracción de agua: para traducir segundos a litros. */
  litrosPorS: Record<string, number>;
};

export type Decision = {
  id: string; tipo: "acortar_enjuague" | "ajustar_dosis" | "revisar_circuito" | "posible_fuga";
  circuitoId: string; circuito: string; fase?: string;
  titulo: string; hoy: string; propuesta: string; porque: string; aplicar: string;
  aguaMesL: number; quimicoMesL: number; minutosMes: number;
  aguaCicloL: number; quimicoCicloL: number; segundosCiclo: number;
  ciclos: number; confianza: "alta" | "media";
  // Solo acortar_enjuague: para dibujar la barra configurado / limpio / sugerido
  configuradoS?: number; p50S?: number; p95S?: number; sugeridoS?: number; primerPasoS?: number;
};

export type Prediccion = {
  circuitoId: string; circuito: string; ciclos: number;
  aguaL: number; aguaP10: number; aguaP90: number; aguaError: number;
  quimicoL: number; quimicoP10: number; quimicoP90: number; quimicoError: number;
  duracionS: number; ultimoMs: number;
};

export function percentil(valores: number[], p: number): number {
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.max(0, Math.ceil((p / 100) * orden.length) - 1)];
}
const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const miles = (n: number) => Math.round(n).toLocaleString("es-CL");
const DIA_MS = 86400000;

/** Error medio al predecir cada ciclo con el promedio de los demás. */
function errorDejandoUnoFuera(v: number[]) {
  if (v.length < 2) return 0;
  const suma = v.reduce((a, b) => a + b, 0);
  return v.reduce((s, x) => s + Math.abs(x - (suma - x) / (v.length - 1)), 0) / v.length;
}

/** Lo que aporta el modelo: el límite superior del tiempo hasta limpio de cada ciclo. */
export type ApoyoModelo = {
  superior: (c: never, fase: string, durS: number) => number | null;
  /** false si el modelo no le gana al promedio: entonces se usa solo la historia. */
  modelo: boolean;
};

export function calcularDecisiones(ciclos: CicloDecision[], ahoraMs: number, cfg = CONFIG_DECISIONES, apoyo?: ApoyoModelo) {
  const decisiones: Decision[] = [];
  const predicciones: Prediccion[] = [];
  const porCircuito = new Map<string, CicloDecision[]>();
  for (const c of ciclos) {
    if (!porCircuito.has(c.circuitoId)) porCircuito.set(c.circuitoId, []);
    porCircuito.get(c.circuitoId)!.push(c);
  }

  for (const [circuitoId, lista] of porCircuito) {
    const orden = [...lista].sort((a, b) => a.inicioMs - b.inicioMs);
    const nombre = orden[0].circuito;
    const ultimos30 = orden.filter((c) => c.inicioMs >= ahoraMs - 30 * DIA_MS);
    const ciclosMes = ultimos30.length;

    // 1. Desvíos repetidos: primero se corrige la causa, no se acorta nada
    const recientes = orden.filter((c) => c.inicioMs >= ahoraMs - cfg.diasRecientes * DIA_MS);
    const conDesvio = recientes.filter((c) => c.resumen.validacion !== "validado");
    const tasaDesvio = recientes.length ? conDesvio.length / recientes.length : 0;
    const problema = recientes.length >= 5 && tasaDesvio >= cfg.tasaDesvio;
    if (problema) {
      const mins = conDesvio.map((c) => c.resumen.tempMinSoda).filter((t): t is number => t !== null);
      decisiones.push({
        id: `${circuitoId}-revisar`, tipo: "revisar_circuito", circuitoId, circuito: nombre,
        titulo: `Revisar el vapor de ${nombre}`,
        hoy: `${conDesvio.length} de ${recientes.length} ciclos con desvío en ${cfg.diasRecientes} días`,
        propuesta: "Revisar vapor y trampa de vapor con mantención",
        porque: mins.length ? `La soda baja hasta ${Math.min(...mins).toFixed(1).replace(".", ",")} °C y cada desvío alarga el ciclo 2 minutos.` : "El ciclo sale de rango con frecuencia.",
        aplicar: "Mientras no se corrija, este circuito no recibe sugerencias para acortar tiempos.",
        aguaMesL: 0, quimicoMesL: 0, minutosMes: Math.round(tasaDesvio * ciclosMes * 2),
        aguaCicloL: 0, quimicoCicloL: 0, segundosCiclo: 120, ciclos: recientes.length, confianza: "alta",
      });
    }

    // 2. Enjuagues que terminan después de quedar limpios
    if (!problema) {
      const nombresFase = orden[0].resumen.fases.filter((f) => f.limpioS !== null || /Enjuague/.test(f.n)).map((f) => f.n);
      for (const fase of nombresFase) {
        const filas = orden.map((c) => c.resumen.fases.find((f) => f.n === fase)).filter(Boolean) as Resumen["fases"];
        if (filas.length < cfg.minCiclos) continue;
        const sinLimpiar = filas.filter((f) => f.limpioS === null).length / filas.length;
        if (sinLimpiar > cfg.maxTasaSinLimpiar) continue;
        const tiempos = filas.map((f) => f.limpioS).filter((t): t is number => t !== null);
        const configuradoS = percentil(filas.map((f) => f.durS), 50);
        const p95S = percentil(tiempos, 95);
        // El modelo considera las condiciones de cada ciclo reciente. Nunca baja del 95 %
        // real observado: una predicción no puede dejar sucio lo que la historia ya midió.
        const superiores = apoyo?.modelo
          ? ultimos30.map((c) => apoyo.superior(c as never, fase, configuradoS)).filter((v): v is number => v !== null)
          : [];
        const usaModelo = superiores.length >= 10;
        const baseS = usaModelo ? Math.max(percentil(superiores, 95), p95S) : p95S * (1 + cfg.margen);
        const sugeridoS = Math.ceil(Math.max(baseS, configuradoS * cfg.fraccionMinima));
        if (sugeridoS >= configuradoS) continue;
        const litrosPorS = orden[orden.length - 1].litrosPorS[fase] ?? 0;
        const aguaCicloL = (configuradoS - sugeridoS) * litrosPorS;
        if (aguaCicloL < cfg.minAhorroL) continue;
        decisiones.push({
          id: `${circuitoId}-${fase}`.replace(/\s/g, "_"), tipo: "acortar_enjuague", circuitoId, circuito: nombre, fase,
          titulo: `Acortar ${fase.toLowerCase()} de ${nombre}`,
          hoy: `Dura ${mmss(configuradoS)} min`,
          propuesta: `Bajar a ${mmss(sugeridoS)} min`,
          porque: usaModelo
            ? `El modelo, según la carga y las condiciones de los últimos ${superiores.length} ciclos, predice agua limpia antes de ${mmss(sugeridoS)} min. En los ${filas.length} ciclos medidos, el 95 % estaba limpio a ${mmss(p95S)} min. El resto del tiempo se gasta agua que ya no limpia nada.`
            : `En ${filas.length} ciclos el agua quedó limpia antes de ${mmss(p95S)} min en el 95 % de los casos. El resto del tiempo se gasta agua que ya no limpia nada.`,
          aplicar: `Primer paso: bajar a ${mmss(Math.ceil(Math.max(sugeridoS, configuradoS * (1 - cfg.fraccionPaso))))} min, verificar la limpieza y seguir bajando.`,
          aguaMesL: Math.round(aguaCicloL * ciclosMes), quimicoMesL: 0,
          minutosMes: Math.round(((configuradoS - sugeridoS) * ciclosMes) / 60),
          aguaCicloL: Math.round(aguaCicloL), quimicoCicloL: 0, segundosCiclo: configuradoS - sugeridoS,
          ciclos: filas.length, confianza: sinLimpiar === 0 ? "alta" : "media",
          configuradoS, p50S: percentil(tiempos, 50), p95S, sugeridoS,
          primerPasoS: Math.ceil(Math.max(sugeridoS, configuradoS * (1 - cfg.fraccionPaso))),
        });
      }
    }

    // 3. Más químico que el de la receta
    const quimicos = orden[0].resumen.fases.filter((f) => f.objetivoC > 0.1);
    for (const q of quimicos) {
      const reales = orden.map((c) => c.resumen.fases.find((f) => f.n === q.n)?.concMedia).filter((v): v is number => typeof v === "number");
      if (reales.length < cfg.minCiclos) continue;
      const real = media(reales);
      if (real / q.objetivoC < cfg.sobredosisMin) continue;
      const quimicoCiclo = media(orden.map((c) => c.resumen.quimicoL));
      const participacion = q.objetivoC / quimicos.reduce((a, f) => a + f.objetivoC, 0);
      const ahorroCiclo = quimicoCiclo * participacion * (1 - q.objetivoC / real);
      decisiones.push({
        id: `${circuitoId}-dosis-${q.n}`.replace(/\s/g, "_"), tipo: "ajustar_dosis", circuitoId, circuito: nombre, fase: q.n,
        titulo: `Ajustar la dosis de ${q.n.toLowerCase()} en ${nombre}`,
        hoy: `Concentración real ${real.toFixed(2).replace(".", ",")} %`,
        propuesta: `Volver a ${q.objetivoC.toFixed(2).replace(".", ",")} % de la receta`,
        porque: `En ${reales.length} ciclos la concentración estuvo ${Math.round((real / q.objetivoC - 1) * 100)} % sobre la receta. Ese exceso se paga en químico y en enjuague.`,
        aplicar: "Revisar la calibración del dosificador y el sensor de conductividad.",
        aguaMesL: 0, quimicoMesL: Math.round(ahorroCiclo * ciclosMes), minutosMes: 0,
        aguaCicloL: 0, quimicoCicloL: +ahorroCiclo.toFixed(1), segundosCiclo: 0, ciclos: reales.length, confianza: "alta",
      });
    }

    // 4. Más agua que su propia historia, con la misma duración
    const corte = ahoraMs - cfg.diasFuga * DIA_MS;
    const ult = orden.filter((c) => c.inicioMs >= corte && c.resumen.validacion === "validado");
    const base = orden.filter((c) => c.inicioMs < corte && c.resumen.validacion === "validado");
    if (ult.length >= 3 && base.length >= 10) {
      const baseAgua = percentil(base.map((c) => c.resumen.aguaL), 50);
      const reciente = percentil(ult.map((c) => c.resumen.aguaL), 50);
      if (reciente / baseAgua >= cfg.excesoFuga) {
        const exceso = reciente - baseAgua;
        decisiones.push({
          id: `${circuitoId}-fuga`, tipo: "posible_fuga", circuitoId, circuito: nombre,
          titulo: `Posible fuga en ${nombre}`,
          hoy: `Usa ${Math.round((reciente / baseAgua - 1) * 100)} % más agua desde hace ${cfg.diasFuga} días`,
          propuesta: "Inspeccionar válvulas y mangueras",
          porque: `Con la misma duración, pasó de ${miles(baseAgua)} L a ${miles(reciente)} L por ciclo. La receta no cambió.`,
          aplicar: "Pedir una inspección a mantención y comparar el próximo ciclo.",
          aguaMesL: Math.round(exceso * ciclosMes), quimicoMesL: 0, minutosMes: 0,
          aguaCicloL: Math.round(exceso), quimicoCicloL: 0, segundosCiclo: 0, ciclos: ult.length, confianza: "media",
        });
      }
    }

    // Consumo esperado del próximo ciclo
    const ventana = orden.slice(-30);
    const agua = ventana.map((c) => c.resumen.aguaL), quim = ventana.map((c) => c.resumen.quimicoL);
    if (ventana.length >= 5) {
      predicciones.push({
        circuitoId, circuito: nombre, ciclos: ventana.length,
        aguaL: Math.round(media(agua)), aguaP10: percentil(agua, 10), aguaP90: percentil(agua, 90), aguaError: Math.round(errorDejandoUnoFuera(agua)),
        quimicoL: +media(quim).toFixed(1), quimicoP10: percentil(quim, 10), quimicoP90: percentil(quim, 90), quimicoError: +errorDejandoUnoFuera(quim).toFixed(1),
        duracionS: Math.round(media(ventana.map((c) => c.resumen.duracionS))), ultimoMs: orden[orden.length - 1].inicioMs,
      });
    }
  }

  // Lo que más ahorra va primero; las revisiones, que bloquean ahorro, arriba de ese grupo
  const peso = (d: Decision) => d.aguaMesL + d.quimicoMesL * 20 + (d.tipo === "posible_fuga" ? 1e6 : d.tipo === "revisar_circuito" ? 1e6 : 0);
  decisiones.sort((a, b) => peso(b) - peso(a));
  return {
    decisiones, predicciones: predicciones.sort((a, b) => b.aguaL - a.aguaL),
    totales: {
      aguaMesL: decisiones.reduce((s, d) => s + d.aguaMesL, 0),
      quimicoMesL: decisiones.reduce((s, d) => s + d.quimicoMesL, 0),
      minutosMes: decisiones.reduce((s, d) => s + d.minutosMes, 0),
      aguaActualMesL: Math.round(ciclos.filter((c) => c.inicioMs >= ahoraMs - 30 * DIA_MS).reduce((s, c) => s + c.resumen.aguaL, 0)),
      quimicoActualMesL: Math.round(ciclos.filter((c) => c.inicioMs >= ahoraMs - 30 * DIA_MS).reduce((s, c) => s + c.resumen.quimicoL, 0)),
      ciclos: ciclos.length,
    },
  };
}
