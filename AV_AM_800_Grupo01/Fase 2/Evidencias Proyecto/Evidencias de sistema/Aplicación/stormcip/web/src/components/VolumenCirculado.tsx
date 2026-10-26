"use client";
import { EstadoVolumen, formatearLitros } from "@/lib/volumenCirculado";

// Litros que pasaron por la línea en cada etapa del ciclo, y el total. Es volumen
// CIRCULADO, no consumo: en soda y ácido el líquido se recircula. Sin caudal
// informado se dice así: un "0 L" se leería como una medición.
//
// Las barras son HTML/CSS y no un gráfico de recharts: una etapa que aún no corrió
// tiene valor cero y recharts no dibuja ni su barra ni su etiqueta, y ahí tiene que
// verse un "—".
export default function VolumenCirculado({ estado }: { estado: EstadoVolumen }) {
  const maximo = estado.tipo === "listo"
    ? Math.max(...estado.filas.map((f) => f.litros ?? 0), 1) : 1;

  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-medium">Volumen circulado</h2>
        {estado.tipo === "listo" && estado.simulado && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Simulado</span>
        )}
        {estado.tipo === "listo" && (
          <span className="ml-auto text-sm">
            Total <b className="text-lg font-semibold tabular-nums">{formatearLitros(estado.total)}</b>
          </span>
        )}
      </div>

      {estado.tipo === "sin_caudal" && (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-600">
          Sin caudal: el equipo no informa caudal en este ciclo, así que no se puede calcular el volumen circulado.
        </p>
      )}
      {estado.tipo === "acumulando" && (
        <p className="text-sm text-slate-500">Acumulando volumen…</p>
      )}

      {estado.tipo === "listo" && (
        <>
          <ul className="space-y-1.5">
            {estado.filas.map((f) => (
              <li key={f.etapa} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 text-sm"
                title={`${f.label}: ${formatearLitros(f.litros)}`}>
                <span className="text-right">{f.label}</span>
                <span className="h-5">
                  {f.litros !== null && (
                    <span className={`block h-full rounded-r ${f.monitoreada ? "bg-blue-500" : "bg-amber-600"}`}
                      style={{ width: `${Math.max((f.litros / maximo) * 100, 0.5)}%` }} />
                  )}
                </span>
                <span className="tabular-nums">{formatearLitros(f.litros)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Es volumen circulado, no consumo: en soda y ácido el líquido se recircula. Integra el caudal
            entre lecturas de la misma etapa (azul enjuagues, ámbar etapas químicas); el cambio de etapa
            no se cuenta, así que puede quedar cerca de un 2 % bajo el volumen real.
            {estado.huecos > 0 && ` ${estado.huecos} corte${estado.huecos === 1 ? "" : "s"} de señal sin contar.`}
          </p>
        </>
      )}
    </section>
  );
}
