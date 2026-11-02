"use client";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  useAlertas, useCicloMostrado, useLecturas, useSondasDispositivo,
  useUmbrales, ultimaLecturaReciente,
} from "@/hooks/useDatosCip";
import { useEstadoProceso } from "@/hooks/useEstadoProceso";
import { useHistorialPlanta } from "@/hooks/useHistorialPlanta";
import { VARIABLES_DE_PLANTA } from "@/lib/historialPlanta";
import ProyeccionEnjuague from "@/components/ProyeccionEnjuague";
import { avisoProyeccion } from "@/lib/proyeccionEnjuague";
import VolumenCirculado from "@/components/VolumenCirculado";
import { estadoVolumen } from "@/lib/volumenCirculado";
import { useAhora } from "@/hooks/useAhora";
import TarjetaSonda from "@/components/TarjetaSonda";
import BarraEtapas from "@/components/BarraEtapas";
import PanelesProceso from "@/components/PanelesProceso";
import ControlSimulacion from "@/components/ControlSimulacion";
import { useSeleccionLinea } from "@/hooks/useSeleccionLinea";
import { ETIQUETA_SELECCION, LINEA_DEMO, SELECCIONES, SeleccionLinea, lineaDe } from "@/lib/lineas";
import GraficoTendencia from "@/components/GraficoTendencia";
import PanelAlertas from "@/components/PanelAlertas";
import IndicadoresCiclo from "@/components/IndicadoresCiclo";
import { ETAPAS_MONITOREADAS, ETAPA_LABEL, META } from "@/lib/tipos";
import { estadoTarjeta, variablesAMostrar } from "@/lib/tarjetas";
import { procesoDelCiclo } from "@/lib/etapas";
import type { EstadoTarjeta } from "@/lib/tarjetas";

// Variables que siguen existiendo (backend, alertas, tendencia) pero no tienen
// tarjeta: conductividad25C es un cálculo y tempEc duplica la temperatura de la
// sonda de pH, que es la que se muestra.
const SIN_TARJETA = ["conductividad25C", "tempEc"];

// Las tarjetas salen de variablesVistas y de las sondas del equipo (ver
// variablesAMostrar), no de una lista fija. conductividad25C va primero porque
// es el indicador real de "agua limpia": sin compensar por temperatura, dos
// lecturas no son comparables entre sí.
// concentracion no es una sonda sino del estado de planta: se grafica con el
// historial que acumula useHistorialPlanta (ver VARIABLES_DE_PLANTA).
const GRAFICABLES = ["conductividad25C", "conductividad", "turbidez", "ph", "concentracion", "tempEc"];

// Todos los roles ven el ciclo; las reglas de Firestore limitan lo que cada uno escribe.
export default function DashboardPage() {
  return <Dashboard />;
}

function Dashboard() {
  const { user, rol } = useAuth();
  // Línea que se muestra (recordada en el navegador)
  const [seleccion, elegirLinea] = useSeleccionLinea();
  const { ciclo, enVivo, cargando: cargandoCiclo } = useCicloMostrado(lineaDe(seleccion) ?? LINEA_DEMO);
  const lecturas = useLecturas(ciclo?.id);
  const alertas = useAlertas();
  const umbrales = useUmbrales();
  const [grafico, setGrafico] = useState("conductividad25C");
  const reciente = ultimaLecturaReciente(ciclo?.ultimaLectura);
  // Sin lectura aún, el equipo es el primero que reportó variables en el ciclo
  const deviceId = reciente.deviceId ?? Object.keys(ciclo?.variablesVistas ?? {})[0];
  const { sondas, cargando: cargandoSondas } = useSondasDispositivo(deviceId);
  const { estado: proceso, cargando: cargandoProceso, detenido } = useEstadoProceso(ciclo?.lineaId);
  const historialPlanta = useHistorialPlanta(ciclo?.id, proceso);
  const ahora = useAhora();

  // GuardRol ya garantiza sesión y rol antes de montar este componente.
  if (!user) return null;

  const etapa = ciclo?.etapaActual ?? "";
  const rangos = umbrales[etapa] ?? {};
  const lectura = reciente.lectura;
  const variables = variablesAMostrar(deviceId ? ciclo?.variablesVistas?.[deviceId] : undefined, sondas);
  const tarjetas = variables.filter((v) => !SIN_TARJETA.includes(v));
  const graficables = GRAFICABLES.filter((v) => variables.includes(v) || VARIABLES_DE_PLANTA.includes(v));
  // Caudal y concentración no salen de las sondas sino del estado de planta (PLC o simulador)
  const planta = procesoDelCiclo(proceso, ciclo?.id ?? "");
  const deInstrumentos = (valor?: number): EstadoTarjeta =>
    valor === undefined
      ? { tipo: "sin_dato", motivo: "sin estado de planta" }
      : { tipo: "normal", valor };
  const estadoCaudal = deInstrumentos(planta?.instrumentos.caudal);
  const estadoConcentracion = deInstrumentos(planta?.instrumentos.concentracion);
  // Sin caudal informado no se muestra "0 L" sino "Sin caudal" (ver estadoVolumen)
  const volumen = estadoVolumen(ciclo, planta?.instrumentos.caudal, enVivo);
  // La variable elegida puede dejar de existir si cambia el equipo o el ciclo
  const graficoActual = graficables.includes(grafico) ? grafico : graficables[0];
  // Eje de tiempo de la tendencia: del inicio del ciclo a su fin, o a "ahora"
  // (redondeado a 5 s para no redibujar el gráfico cada segundo) si sigue en curso
  const inicioMs = ciclo?.inicio?.toDate ? ciclo.inicio.toDate().getTime() : null;
  const finMs = ciclo?.fin?.toDate ? ciclo.fin.toDate().getTime() : Math.floor(ahora / 5000) * 5000;
  const etapaFueraDeAlcance = enVivo && etapa !== "" && !ETAPAS_MONITOREADAS.includes(etapa);

  const aviso = avisoProyeccion(ciclo, deviceId, enVivo);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">Lecturas directas de las sondas WQS-LB. {enVivo ? "Monitoreo en vivo" : "Último ciclo cerrado"}</p>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          Línea
          <select value={seleccion} onChange={(e) => elegirLinea(e.target.value as SeleccionLinea)}
            className="rounded-ctrl border border-line-2 px-2 py-1 text-[13px]">
            {SELECCIONES.map((sel) => <option key={sel} value={sel}>{ETIQUETA_SELECCION[sel]}</option>)}
          </select>
        </label>
      </div>

      {cargandoCiclo ? <p className="text-ink-3">Buscando ciclo…</p>
       : !ciclo ? <p className="sc-card p-8 text-center text-ink-3">No hay ciclos en curso ni cerrados en esta línea.</p>
       : <>
        <section className="sc-card flex flex-wrap items-center gap-x-8 gap-y-1.5 px-4 py-2.5 text-[12.5px]">
          <span><span className="text-ink-3">Ciclo </span><b className="font-mono font-semibold text-accent-ink">{ciclo.id}</b></span>
          <span><span className="text-ink-3">Línea </span><b className="font-mono font-medium">{ciclo.lineaId}</b></span>
          <span><span className="text-ink-3">Programa </span>{ciclo.programa}</span>
          <span><span className="text-ink-3">Camión </span><b className="font-mono font-medium">{ciclo.camion}</b></span>
          {deviceId && <span><span className="text-ink-3">Equipo </span><b className="font-mono font-medium">{deviceId}</b></span>}
          <span><span className="text-ink-3">Inicio </span><b className="font-mono font-medium">{ciclo.inicio?.toDate
            ? ciclo.inicio.toDate().toLocaleTimeString("es-CL") : "—"}</b></span>
          {ciclo.fin?.toDate && (
            <span><span className="text-ink-3">Fin </span><b className="font-mono font-medium">{ciclo.fin.toDate().toLocaleTimeString("es-CL")}</b></span>
          )}
          {ciclo.simulado && <span className="ml-auto"><span className="demo-chip">Datos simulados</span></span>}
        </section>

        <BarraEtapas ciclo={ciclo} proceso={proceso} detenido={detenido} ahora={ahora} />

        {/* Sin este aviso, las tarjetas y la tendencia de un ciclo ya cerrado se
            leen como si fueran datos de ahora. */}
        {!enVivo && (
          <p className="sc-card p-3 text-[13px] text-ink-2">
            No hay ciclos en curso. Se muestra el último ciclo cerrado: las tarjetas y
            la tendencia son sus lecturas finales, no datos en vivo.
          </p>
        )}

        {/* Honestidad sobre el alcance: en etapas químicas las sondas están fuera
            de su rango de operación y no se debe confiar en el dato. */}
        {etapaFueraDeAlcance && (
          <p className="rounded-card border border-warn/60 bg-warn/10 p-3 text-[13px] text-warn">
            Etapa fuera del alcance de monitoreo: las sondas WQS operan hasta 60 °C
            {variables.includes("turbidez") && " (turbidez hasta 40 °C)"}. Los valores
            mostrados no son confiables en esta etapa.
          </p>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {cargandoSondas ? <p className="col-span-full text-sm text-ink-3">Leyendo equipo…</p>
               : <>
                  {variables.length === 0 && (
                    <p className="sc-card col-span-full p-4 text-sm text-ink-3">
                      El equipo aún no reporta variables en este ciclo.</p>
                  )}
                  {tarjetas.map((v) => (
                    <TarjetaSonda key={v} variable={v} rango={rangos[v]}
                      estado={estadoTarjeta(v, lectura, sondas)} />
                  ))}
                  <TarjetaSonda variable="caudal" estado={estadoCaudal} />
                  <TarjetaSonda variable="concentracion" rango={rangos.concentracion}
                    estado={estadoConcentracion} />
                </>}
            </section>

            <section className="sc-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="sc-eyebrow">Tendencia</h2>
                <select value={graficoActual ?? ""} onChange={(e) => setGrafico(e.target.value)}
                  className="rounded-ctrl border border-line-2 px-2 py-1 text-[13px]">
                  {graficables.map((v) => <option key={v} value={v}>{META[v].label}</option>)}
                </select>
              </div>
              {graficoActual
                ? <GraficoTendencia
                    lecturas={VARIABLES_DE_PLANTA.includes(graficoActual) ? historialPlanta : lecturas}
                    variable={graficoActual} rango={rangos[graficoActual]}
                    inicioMs={inicioMs} finMs={finMs} etapaActual={etapa} />
                : <p className="text-sm text-ink-3">Sin variables graficables todavía.</p>}
              <p className="mt-2 text-xs text-ink-3">
                {lecturas.length} lectura{lecturas.length === 1 ? "" : "s"} del ciclo, desde su inicio.
              </p>
            </section>

            <VolumenCirculado estado={volumen} />

            {/* Los indicadores los calcula el backend al cerrar el ciclo (derivarCiclo) */}
            <IndicadoresCiclo ciclo={ciclo} />
          </div>

          <aside className="min-w-0 space-y-4">
            <ProyeccionEnjuague aviso={aviso} />
            <PanelesProceso cicloId={ciclo.id} proceso={proceso} cargando={cargandoProceso}
              detenido={detenido} />
            <section className="sc-card p-4">
              <h2 className="sc-eyebrow mb-3">Alertas activas</h2>
              <PanelAlertas alertas={alertas} />
            </section>
            {/* Solo el rol admin puede dar órdenes: las reglas también lo exigen */}
            {seleccion !== "real" && rol === "admin" && <ControlSimulacion />}
          </aside>
        </div>
       </>}
      {!ciclo && !cargandoCiclo && seleccion !== "real" && rol === "admin" && <ControlSimulacion />}
    </div>
  );
}
