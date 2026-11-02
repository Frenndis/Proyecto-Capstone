"use client";
import { useState } from "react";
import { useControlSimulacion } from "@/hooks/useControlSimulacion";
import { useCicloEnCursoId } from "@/hooks/useDatosCip";
import { ESCENARIOS, ETIQUETA_ESCENARIO, Escenario, estadoBoton } from "@/lib/controlSimulacion";
import { LINEA_DEMO } from "@/lib/lineas";

// Botón de la demo: pide al simulador (sim:cip --esperar) que corra un ciclo en la
// línea de demo, o que lo detenga. La web no crea ciclos: solo escribe la orden.
export default function ControlSimulacion() {
  const { estado, vivo, resultado, esperandoRespuesta, errorEnvio, enviar, cargando } =
    useControlSimulacion(LINEA_DEMO);
  const { cicloId: cicloEnCursoId } = useCicloEnCursoId(LINEA_DEMO);
  const [escenario, setEscenario] = useState<Escenario>("normal");

  const boton = estadoBoton({ vivo, estado, cicloEnCursoId, esperandoRespuesta });
  const ejecutando = vivo && estado?.estado === "ejecutando";

  return (
    <section className="sc-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="sc-eyebrow">Simulación de la demo</h2>
        <span className="text-xs text-ink-3">línea {LINEA_DEMO}</span>
        <span className={`rounded-ctrl px-2 py-0.5 text-[10px] font-semibold uppercase ${
          cargando ? "bg-raise text-ink-3"
          : vivo ? "bg-ok/10 text-ok"
          : "bg-crit/10 text-crit"}`}>
          {cargando ? "leyendo…" : vivo ? "simulador activo" : "simulador apagado"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Escenario
          <select value={escenario} onChange={(e) => setEscenario(e.target.value as Escenario)}
            disabled={!boton.puedeIniciar}
            className="rounded-ctrl border px-2 py-1 text-sm">
            {ESCENARIOS.map((e) => <option key={e} value={e}>{ETIQUETA_ESCENARIO[e]}</option>)}
          </select>
        </label>
        <button onClick={() => enviar("iniciar", escenario)} disabled={!boton.puedeIniciar}
          className="rounded-ctrl bg-brand px-3 py-1.5 text-sm font-medium text-[#06121f]
                     disabled:cursor-not-allowed disabled:opacity-40">
          Iniciar simulación
        </button>
        <button onClick={() => enviar("detener", null)} disabled={!boton.puedeDetener}
          className="rounded-ctrl border border-crit px-3 py-1.5 text-sm font-medium text-crit
                     disabled:cursor-not-allowed disabled:opacity-40">
          Detener
        </button>
      </div>

      <div className="mt-2 space-y-1 text-xs text-ink-3">
        {ejecutando && (
          <p>En curso: escenario <b>{estado?.escenario ? ETIQUETA_ESCENARIO[estado.escenario] : "—"}</b>
            {estado?.cicloId && <> · ciclo {estado.cicloId}</>}. «Detener» lo deja como abortado.</p>
        )}
        {!boton.puedeIniciar && !cargando && boton.motivoIniciar && <p>{boton.motivoIniciar}.</p>}
        {!vivo && !cargando && (
          <p>Para habilitarlo, inicia el simulador en una terminal: <code>npm run sim:cip -- --esperar</code></p>
        )}
        {resultado?.tipo === "rechazada" && (
          <p className="text-crit">El simulador rechazó la orden: {resultado.motivo}.</p>
        )}
        {resultado?.tipo === "sin_respuesta" && (
          <p className="text-crit">El simulador no respondió a la orden.</p>
        )}
        {errorEnvio && <p className="text-crit">{errorEnvio}</p>}
      </div>
    </section>
  );
}
