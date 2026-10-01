"use client";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Alerta, META } from "@/lib/tipos";
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
        <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <div>
            <p className="font-medium">
              {META[a.variable]?.label ?? a.variable}: {a.valor} {META[a.variable]?.unidad}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {a.etapa} · límite {a.min ?? "—"}–{a.max ?? "—"} ·{" "}
              {a.ts?.toDate ? a.ts.toDate().toLocaleTimeString("es-CL") : ""}
            </p>
          </div>
          {puedeReconocer && (
            <button onClick={() => reconocer(a.id)}
              className="shrink-0 rounded-md bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700">
              Reconocer
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
