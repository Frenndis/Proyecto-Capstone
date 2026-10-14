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
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-medium">Simulación de la demo</h2>
        <span className="text-xs text-slate-500">línea {LINEA_DEMO}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
          cargando ? "bg-slate-100 text-slate-500 dark:bg-slate-800"
          : vivo ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"}`}>
          {cargando ? "leyendo…" : vivo ? "simulador activo" : "simulador apagado"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Escenario
          <select value={escenario} onChange={(e) => setEscenario(e.target.value as Escenario)}
            disabled={!boton.puedeIniciar}
            className="rounded-md border px-2 py-1 text-sm dark:bg-slate-900">
            {ESCENARIOS.map((e) => <option key={e} value={e}>{ETIQUETA_ESCENARIO[e]}</option>)}
          </select>
        </label>
        <button onClick={() => enviar("iniciar", escenario)} disabled={!boton.puedeIniciar}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white
                     disabled:cursor-not-allowed disabled:opacity-40">
          Iniciar simulación
        </button>
        <button onClick={() => enviar("detener", null)} disabled={!boton.puedeDetener}
          className="rounded-lg border border-red-400 px-3 py-1.5 text-sm font-medium text-red-700
                     disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300">
          Detener
        </button>
      </div>

      <div className="mt-2 space-y-1 text-xs text-slate-500">
        {ejecutando && (
          <p>En curso: escenario <b>{estado?.escenario ? ETIQUETA_ESCENARIO[estado.escenario] : "—"}</b>
            {estado?.cicloId && <> · ciclo {estado.cicloId}</>}. «Detener» lo deja como abortado.</p>
        )}
        {!boton.puedeIniciar && !cargando && boton.motivoIniciar && <p>{boton.motivoIniciar}.</p>}
        {!vivo && !cargando && (
          <p>Para habilitarlo, inicia el simulador en una terminal: <code>npm run sim:cip -- --esperar</code></p>
        )}
        {resultado?.tipo === "rechazada" && (
          <p className="text-red-600 dark:text-red-400">El simulador rechazó la orden: {resultado.motivo}.</p>
        )}
        {resultado?.tipo === "sin_respuesta" && (
          <p className="text-red-600 dark:text-red-400">El simulador no respondió a la orden.</p>
        )}
        {errorEnvio && <p className="text-red-600 dark:text-red-400">{errorEnvio}</p>}
      </div>
    </section>
  );
}
