"use client";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Lectura, META } from "@/lib/tipos";

export default function GraficoTendencia(
  { lecturas, variable }: { lecturas: Lectura[]; variable: string }
) {
  const data = lecturas
    .filter((l) => typeof l[variable] === "number")
    .map((l) => ({
      hora: l.ts?.toDate ? l.ts.toDate().toLocaleTimeString("es-CL", {
        hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "",
      valor: l[variable],
    }));

  if (!data.length) return <p className="text-sm text-slate-500">Sin datos todavía.</p>;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="hora" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
        <Tooltip formatter={(v: any) => [`${v} ${META[variable]?.unidad ?? ""}`, META[variable]?.label]} />
        <Line type="monotone" dataKey="valor" stroke="#2563eb" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
