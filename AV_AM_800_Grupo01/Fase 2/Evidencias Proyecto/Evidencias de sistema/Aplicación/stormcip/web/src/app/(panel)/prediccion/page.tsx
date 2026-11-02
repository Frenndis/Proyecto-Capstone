"use client";
import { useCiclosRecientes, useModelos } from "@/hooks/useCiclos";
import ProyeccionEnjuague from "@/components/ProyeccionEnjuague";
import { Simulado, Tarjeta, Vacio } from "@/components/ui/Sala";
import { ModeloPrograma, PrediccionConsumo, Recomendacion, ahorroTotalPorCiclo, formatoTiempo } from "@/lib/central";
import { avisoProyeccion } from "@/lib/proyeccionEnjuague";
import { ETAPA_LABEL } from "@/lib/tipos";

const miles = (n: number, dec = 0) => n.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });

function textoSinSugerencia(r: Exclude<Recomendacion, { estado: "sugerencia" }>) {
  switch (r.estado) {
    case "faltan_ciclos": return `Faltan ciclos: ${r.ciclos} de ${r.requeridos}.`;
    case "sin_configuracion": return "El ciclo no registra el tiempo configurado de esta etapa.";
    case "inestable": return `${miles(r.tasaSinLimpiar * 100, 1)} % de los ciclos no llegó a agua limpia: primero hay que estabilizar el proceso.`;
    case "sin_ahorro": return `Ya usa casi todo su tiempo: el 95 % queda limpio en ${formatoTiempo(r.p95S)}.`;
  }
}

function FilaEtapa({ etapa, r }: { etapa: string; r: Recomendacion }) {
  return (
    <tr>
      <td className="font-medium">{ETAPA_LABEL[etapa] ?? etapa}</td>
      {r.estado === "sugerencia" ? (
        <>
          <td className="num">{formatoTiempo(r.configuradoS)}</td>
          <td className="num">{formatoTiempo(r.p95S)}</td>
          <td className="num font-semibold text-accent-ink">{formatoTiempo(r.sugeridoS)}</td>
          <td className="num">{formatoTiempo(r.siguientePasoS)}</td>
          <td className="num font-semibold text-ok">{miles(r.ahorroAguaL)} L</td>
        </>
      ) : <td colSpan={5} className="whitespace-normal text-ink-3">{textoSinSugerencia(r)}</td>}
    </tr>
  );
}

function CeldaConsumo({ titulo, p, unidad, dec }: { titulo: string; p: PrediccionConsumo; unidad: string; dec: number }) {
  return (
    <div className="px-4 py-3">
      <p className="sc-eyebrow">{titulo}</p>
      {p.estado === "listo" ? (
        <>
          <p className="sc-kpi mt-1 text-warn">≈ {miles(p.esperado, dec)}<span className="ml-1 text-sm font-normal text-ink-3">{unidad}</span></p>
          <p className="mt-0.5 font-mono text-[11px] text-ink-3">rango {miles(p.p10, dec)} a {miles(p.p90, dec)} · error ± {miles(p.errorMedio, dec)}</p>
        </>
      ) : <p className="mt-2 text-sm text-ink-3">Faltan ciclos: {p.ciclos} de {p.requeridos}.</p>}
    </div>
  );
}

function Programa({ m }: { m: ModeloPrograma }) {
  const ahorro = ahorroTotalPorCiclo(m);
  return (
    <Tarjeta titulo={`${m.programa} · ${m.lineaId}`}
      derecha={<span className="flex items-center gap-3">{m.conDatosSimulados && <Simulado />}<span className="font-mono">{m.ciclos} ciclos</span></span>}>
      <div className="grid gap-px border-b border-line bg-line md:grid-cols-[1.1fr_1fr_1fr_1fr]">
        <div className="bg-surface px-4 py-3">
          <p className="sc-eyebrow">Ahorro posible por ciclo</p>
          <p className="sc-kpi mt-1 text-ok">{miles(ahorro)}<span className="ml-1 text-sm font-normal text-ink-3">L de agua</span></p>
          <p className="mt-0.5 text-[11px] text-ink-3">a caudal nominal de {m.caudalM3h} m³/h</p>
        </div>
        <div className="bg-surface"><CeldaConsumo titulo="Agua esperada" p={m.consumo.aguaTotal} unidad="m³" dec={2} /></div>
        <div className="bg-surface"><CeldaConsumo titulo="Soda esperada" p={m.consumo.soda} unidad="L" dec={0} /></div>
        <div className="bg-surface"><CeldaConsumo titulo="Ácido esperado" p={m.consumo.acido} unidad="L" dec={0} /></div>
      </div>
      <div className="overflow-x-auto">
        <table className="sc-table">
          <thead>
            <tr>
              <th>Etapa</th><th className="text-right">Configurado</th><th className="text-right">Limpio, 95 % de ciclos</th>
              <th className="text-right">Tiempo sugerido</th><th className="text-right">Primer paso</th><th className="text-right">Ahorro por ciclo</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(m.etapas).map(([e, r]) => <FilaEtapa key={e} etapa={e} r={r} />)}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  );
}

export default function PrediccionPage() {
  const { modelos, cargando } = useModelos();
  const { ciclos } = useCiclosRecientes(20);
  const programas = Object.values(modelos).filter((m) => m?.etapas);
  const enCurso = ciclos.find((c) => c.estado === "en_curso");
  const equipo = Object.keys(enCurso?.proyeccionEnjuague ?? {})[0];
  const aviso = avisoProyeccion(enCurso, equipo, !!enCurso);

  return (
    <div className="space-y-4">
      <ProyeccionEnjuague aviso={aviso} />

      {programas.length === 0
        ? <Tarjeta><Vacio>{cargando ? "Leyendo modelos…" : "Los modelos aparecen cuando cierra el primer ciclo de un programa."}</Vacio></Tarjeta>
        : programas.map((m) => <Programa key={`${m.lineaId}-${m.programa}`} m={m} />)}

      <Tarjeta titulo="Cómo leer esta pantalla">
        <ul className="max-w-3xl list-disc space-y-1.5 py-3 pl-8 pr-4 text-[13px] text-ink-2">
          <li>El tiempo sugerido es el percentil 95 del tiempo hasta agua limpia, más 10 % de margen. Nunca baja de la mitad de lo configurado.</li>
          <li>Se aplica por pasos, con un máximo de 10 % en cada cambio, verificando la limpieza antes del siguiente.</li>
          <li>Son recomendaciones: calidad aprueba cada cambio y Storm CIP no modifica la receta ni el PLC.</li>
          <li>Solo cubre los enjuagues. Las etapas con químicos necesitan validación de higiene y sensores aptos para esas condiciones.</li>
        </ul>
      </Tarjeta>
    </div>
  );
}
