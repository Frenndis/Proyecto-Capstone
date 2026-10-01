"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useAlertas, useCicloActivo, useLecturas, useUmbrales } from "@/hooks/useDatosCip";
import TarjetaVariable from "@/components/TarjetaVariable";
import GraficoTendencia from "@/components/GraficoTendencia";
import PanelAlertas from "@/components/PanelAlertas";
import { ETAPA_LABEL, META } from "@/lib/tipos";

const VISIBLES = ["temperatura", "concentracion", "caudal", "presion", "ph", "turbidez"];

export default function Dashboard() {
  const router = useRouter();
  const { user, rol, cargando, salir } = useAuth();
  const { ciclo, cargando: cargandoCiclo } = useCicloActivo();
  const lecturas = useLecturas(ciclo?.id);
  const alertas = useAlertas();
  const umbrales = useUmbrales();
  const [grafico, setGrafico] = useState("temperatura");

  useEffect(() => { if (!cargando && !user) router.replace("/login"); }, [cargando, user, router]);

  if (cargando || !user) return <p className="p-6 text-slate-500">Cargando…</p>;

  const etapa = ciclo?.etapaActual ?? "";
  const rangos = umbrales[etapa] ?? {};
  const ultima = ciclo?.ultimaLectura ?? {};

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">StormCIP · Monitoreo en vivo</h1>
          <p className="text-sm text-slate-500">{user.email} · rol: {rol ?? "sin rol"}</p>
        </div>
        <button onClick={salir} className="rounded-lg border px-3 py-1 text-sm">Salir</button>
      </header>

      {cargandoCiclo ? <p className="text-slate-500">Buscando ciclo activo…</p>
       : !ciclo ? <p className="rounded-lg border border-dashed p-6 text-slate-500">
            No hay ciclos en curso. Ejecuta el seed y el simulador.</p>
       : <>
        <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span><b>Ciclo:</b> {ciclo.id}</span>
            <span><b>Línea:</b> {ciclo.lineaId}</span>
            <span><b>Camión:</b> {ciclo.camion}</span>
            <span><b>Etapa:</b> {ETAPA_LABEL[etapa] ?? etapa}</span>
            <span><b>Inicio:</b> {ciclo.inicio?.toDate
              ? ciclo.inicio.toDate().toLocaleTimeString("es-CL") : "—"}</span>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {VISIBLES.map((v) => (
            <TarjetaVariable key={v} variable={v} valor={ultima[v]} rango={rangos[v]} />
          ))}
        </section>

        <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Tendencia</h2>
            <select value={grafico} onChange={(e) => setGrafico(e.target.value)}
              className="rounded-md border px-2 py-1 text-sm dark:bg-slate-900">
              {VISIBLES.map((v) => <option key={v} value={v}>{META[v].label}</option>)}
            </select>
          </div>
          <GraficoTendencia lecturas={lecturas} variable={grafico} />
        </section>
       </>}

      <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <h2 className="mb-3 font-medium">Alertas activas</h2>
        <PanelAlertas alertas={alertas} />
      </section>
    </main>
  );
}
