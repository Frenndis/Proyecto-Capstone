"use client";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import GuardRol from "@/components/layout/GuardRol";
import {
  useAlertas, useCicloMostrado, useHistorialAlertas, useLecturas, useUmbrales,
  ultimaLecturaReciente,
} from "@/hooks/useDatosCip";
import TarjetaVariable from "@/components/TarjetaVariable";
import GraficoTendencia from "@/components/GraficoTendencia";
import PanelAlertas from "@/components/PanelAlertas";
import HistorialAlertas from "@/components/HistorialAlertas";
import IndicadoresCiclo from "@/components/IndicadoresCiclo";
import { ETAPAS_MONITOREADAS, ETAPA_LABEL, META } from "@/lib/tipos";

// Alcance del MVP: las sondas WQS solo operan dentro de rango en los enjuagues.
// conductividad25C va primero porque es el indicador real de "agua limpia":
// sin compensar por temperatura, dos lecturas no son comparables entre sí.
const VISIBLES = [
  "conductividad25C", "conductividad", "turbidez", "ph", "tempEc", "tempExterna",
];
const GRAFICABLES = ["conductividad25C", "conductividad", "turbidez", "ph", "tempEc"];

// Por ahora solo admin. Cuando se definan los permisos de operador, se agrega
// aquí y se limitan las funciones dentro del dashboard según `rol`.
export default function DashboardPage() {
  return (
    <GuardRol roles={["admin"]}>
      <Dashboard />
    </GuardRol>
  );
}

function Dashboard() {
  const { user, rol, salir } = useAuth();
  const { ciclo, enVivo, cargando: cargandoCiclo } = useCicloMostrado();
  const lecturas = useLecturas(ciclo?.id);
  const alertas = useAlertas();
  const historialAlertas = useHistorialAlertas();
  const umbrales = useUmbrales();
  const [grafico, setGrafico] = useState("conductividad25C");

  // GuardRol ya garantiza sesión y rol antes de montar este componente.
  if (!user) return null;

  const etapa = ciclo?.etapaActual ?? "";
  const rangos = umbrales[etapa] ?? {};
  const { deviceId, lectura } = ultimaLecturaReciente(ciclo?.ultimaLectura);
  const valores = lectura?.valores ?? {};
  const derivados = lectura?.derivados ?? {};
  const etapaFueraDeAlcance = enVivo && etapa !== "" && !ETAPAS_MONITOREADAS.includes(etapa);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            StormCIP · {enVivo ? "Monitoreo en vivo" : "Último ciclo cerrado"}
          </h1>
          <p className="text-sm text-slate-500">{user.email} · rol: {rol ?? "sin rol"}</p>
        </div>
        <button onClick={salir} className="rounded-lg border px-3 py-1 text-sm">Salir</button>
      </header>

      {cargandoCiclo ? <p className="text-slate-500">Buscando ciclo…</p>
       : !ciclo ? <p className="rounded-lg border border-dashed p-6 text-slate-500">
            No hay ciclos en curso ni cerrados. Ejecuta el seed y el simulador.</p>
       : <>
        <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span><b>Ciclo:</b> {ciclo.id}</span>
            <span><b>Línea:</b> {ciclo.lineaId}</span>
            <span><b>Camión:</b> {ciclo.camion}</span>
            <span><b>Etapa:</b> {ETAPA_LABEL[etapa] ?? etapa}</span>
            <span><b>Estado:</b> {ciclo.estado}</span>
            {deviceId && <span><b>Equipo:</b> {deviceId}</span>}
            <span><b>Inicio:</b> {ciclo.inicio?.toDate
              ? ciclo.inicio.toDate().toLocaleTimeString("es-CL") : "—"}</span>
            {ciclo.fin?.toDate && (
              <span><b>Fin:</b> {ciclo.fin.toDate().toLocaleTimeString("es-CL")}</span>
            )}
          </div>
        </section>

        {/* Sin este aviso, las tarjetas y la tendencia de un ciclo ya cerrado se
            leen como si fueran datos de ahora. */}
        {!enVivo && (
          <p className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm
                        text-slate-600 dark:border-slate-600 dark:bg-slate-800/40
                        dark:text-slate-300">
            No hay ciclos en curso. Se muestra el último ciclo cerrado: las tarjetas y
            la tendencia son sus lecturas finales, no datos en vivo.
          </p>
        )}

        {/* Honestidad sobre el alcance: en etapas químicas las sondas están fuera
            de su rango de operación y no se debe confiar en el dato. */}
        {etapaFueraDeAlcance && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm
                        text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Etapa fuera del alcance de monitoreo: las sondas WQS operan hasta 60 °C
            (turbidez hasta 40 °C). Los valores mostrados no son confiables en esta etapa.
          </p>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {VISIBLES.map((v) => (
            <TarjetaVariable key={v} variable={v}
              valor={valores[v] ?? derivados[v]}
              rango={rangos[v]}
              confianza={lectura && (lectura as any).confianza?.[v]} />
          ))}
        </section>

        <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Tendencia</h2>
            <select value={grafico} onChange={(e) => setGrafico(e.target.value)}
              className="rounded-md border px-2 py-1 text-sm dark:bg-slate-900">
              {GRAFICABLES.map((v) => <option key={v} value={v}>{META[v].label}</option>)}
            </select>
          </div>
          <GraficoTendencia lecturas={lecturas} variable={grafico} rango={rangos[grafico]} />
          <p className="mt-2 text-xs text-slate-500">
            Últimas {lecturas.length} lecturas del ciclo.
          </p>
        </section>

        {/* Los indicadores los calcula el backend al cerrar el ciclo (derivarCiclo) */}
        <IndicadoresCiclo ciclo={ciclo} />
       </>}

      <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <h2 className="mb-3 font-medium">Alertas activas</h2>
        <PanelAlertas alertas={alertas} />
      </section>

      <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <h2 className="mb-3 font-medium">Historial de alertas</h2>
        <HistorialAlertas alertas={historialAlertas} />
      </section>
    </main>
  );
}
