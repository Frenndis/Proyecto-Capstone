"use client";
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Lectura, META, Rango, formatear, valorDe } from "@/lib/tipos";

export default function GraficoTendencia({
  lecturas, variable, rango,
}: { lecturas: Lectura[]; variable: string; rango?: Rango }) {
  // valorDe busca primero en `valores` (medido) y luego en `derivados` (calculado),
  // así el mismo gráfico sirve para conductividad y para conductividad25C.
  const data = lecturas
    .map((l) => ({ l, v: valorDe(l, variable) }))
    .filter((x) => typeof x.v === "number")
    .map(({ l, v }) => ({
      hora: l.ts?.toDate ? l.ts.toDate().toLocaleTimeString("es-CL", {
        hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "",
      valor: v as number,
    }));

  if (!data.length) return <p className="text-sm text-slate-500">Sin datos todavía.</p>;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="hora" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
        <Tooltip formatter={(v: any) =>
          [`${formatear(variable, v)} ${META[variable]?.unidad ?? ""}`, META[variable]?.label]} />
        {/* Los umbrales dibujados hacen legible la caída del enjuague */}
        {rango?.max !== undefined && (
          <ReferenceLine y={rango.max} stroke="#dc2626" strokeDasharray="4 4"
            label={{ value: `máx ${rango.max}`, position: "right", fontSize: 10, fill: "#dc2626" }} />
        )}
        {rango?.min !== undefined && (
          <ReferenceLine y={rango.min} stroke="#dc2626" strokeDasharray="4 4"
            label={{ value: `mín ${rango.min}`, position: "right", fontSize: 10, fill: "#dc2626" }} />
        )}
        <Line type="monotone" dataKey="valor" stroke="#2563eb" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
