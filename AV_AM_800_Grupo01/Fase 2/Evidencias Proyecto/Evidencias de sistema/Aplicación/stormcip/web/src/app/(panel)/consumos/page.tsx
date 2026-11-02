"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCiclosRecientes } from "@/hooks/useCiclos";
import { FilaKpi, Kpi, Simulado, Tarjeta, Vacio } from "@/components/ui/Sala";
import { aguaPorDia, consumoPorPrograma } from "@/lib/central";

const miles = (n: number, dec = 0) => n.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const EJE = { fontSize: 10.5, fill: "#8CA1B8", fontFamily: "IBM Plex Mono, monospace" };

export default function ConsumosPage() {
  const { ciclos, cargando } = useCiclosRecientes();
  const filas = consumoPorPrograma(ciclos);
  const dias = aguaPorDia(ciclos, new Date());
  const t = filas.reduce((s, f) => ({
    ciclos: s.ciclos + f.ciclos, agua: s.agua + f.aguaM3, soda: s.soda + f.sodaL, acido: s.acido + f.acidoL,
  }), { ciclos: 0, agua: 0, soda: 0, acido: 0 });
  const porCiclo = t.ciclos ? (t.agua / t.ciclos) * 1000 : 0;
  const maxAgua = Math.max(...filas.map((f) => f.aguaM3), 0.001);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-3">Últimos {ciclos.length} ciclos. Soda y ácido son solución de trabajo estimada, no químico concentrado.</p>
        {ciclos.some((c) => c.simulado) && <Simulado />}
      </div>

      <FilaKpi>
        <Kpi etiqueta="Agua de red" valor={miles(t.agua, 2)} unidad="m³" detalle={`${t.ciclos} ciclos cerrados`} />
        <Kpi etiqueta="Agua por ciclo" valor={miles(porCiclo)} unidad="L" detalle="promedio" />
        <Kpi etiqueta="≈ Soda" valor={miles(t.soda)} unidad="L" detalle="estimado" tono="warn" />
        <Kpi etiqueta="≈ Ácido" valor={miles(t.acido)} unidad="L" detalle="estimado" tono="warn" />
      </FilaKpi>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Agua de red por día · 30 días" derecha="m³">
          <div className="p-3">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dias} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="#1D3049" vertical={false} />
                <XAxis dataKey="dia" tick={EJE} tickLine={false} axisLine={{ stroke: "#2A415E" }} minTickGap={24} />
                <YAxis tick={EJE} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "#12223A" }}
                  contentStyle={{ background: "#0E1B2E", border: "1px solid #2A415E", borderRadius: 4, fontSize: 12 }}
                  labelStyle={{ color: "#E8F0F8" }} formatter={(v) => [`${v} m³`, "Agua"]} />
                <Bar dataKey="aguaM3" fill="#3E8FC7" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Agua por programa" derecha="m³">
          {filas.length === 0 ? <Vacio>{cargando ? "Leyendo ciclos…" : "Aún no hay ciclos cerrados."}</Vacio> : (
            <ul className="divide-y divide-line">
              {filas.map((f) => (
                <li key={f.clave} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,160px)_56px] items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <b className="block truncate text-[13px] font-semibold">{f.clave}</b>
                    <span className="font-mono text-[11px] text-ink-3">
                      {f.ciclos} ciclos · ≈ {miles(f.sodaL / f.ciclos)} L soda · ≈ {miles(f.acidoL / f.ciclos)} L ácido
                    </span>
                  </div>
                  <span className="h-1.5 rounded-full bg-line">
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${(f.aguaM3 / maxAgua) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono text-[13px] font-semibold tabular-nums">{miles(f.aguaM3, 1)}</span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
