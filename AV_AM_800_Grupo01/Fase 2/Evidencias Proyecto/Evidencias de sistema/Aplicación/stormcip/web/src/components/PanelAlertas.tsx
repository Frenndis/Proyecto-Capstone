"use client";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Alerta, ETAPA_LABEL, META, formatear, formatearRango } from "@/lib/tipos";
import { useAuth } from "@/lib/auth-context";

export default function PanelAlertas({ alertas }: { alertas: Alerta[] }) {
  const { rol } = useAuth();
  const puedeReconocer = rol === "admin" || rol === "operador";

  // Las reglas de Firestore solo permiten tocar estos 3 campos
  const reconocer = (id: string) => updateDoc(doc(db, "alertas", id), {
    reconocida: true,
    reconocidaPor: auth.currentUser?.uid ?? null,
    reconocidaEn: serverTimestamp(),
  });

  if (!alertas.length)
    return <p className="text-sm text-slate-500">Sin alertas activas.</p>;

  return (
    <ul className="space-y-2">
      {alertas.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg
                                  border border-amber-300 bg-amber-50 p-3 text-sm
                                  dark:bg-amber-950/30">
          <div>
            <p className="font-medium">
              {META[a.variable]?.label ?? a.variable}:{" "}
              {formatear(a.variable, a.ultimoValor)} {META[a.variable]?.unidad}
              {/* v2: una alerta por condición, con cuántas veces se repitió */}
              {typeof a.conteo === "number" && a.conteo > 1 && (
                <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[10px]
                                 text-amber-900 dark:bg-amber-800 dark:text-amber-100">
                  ×{a.conteo}
                </span>
              )}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {ETAPA_LABEL[a.etapa] ?? a.etapa} · límite {formatearRango(a)} ·
              {" desde "}
              {a.desde?.toDate ? a.desde.toDate().toLocaleTimeString("es-CL") : "—"}
              {a.hasta?.toDate && ` · última ${a.hasta.toDate().toLocaleTimeString("es-CL")}`}
            </p>
          </div>
          {puedeReconocer && (
            <button onClick={() => reconocer(a.id)}
              className="shrink-0 rounded-md bg-slate-900 px-3 py-1 text-xs text-white
                         hover:bg-slate-700">
              Reconocer
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
