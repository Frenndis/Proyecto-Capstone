"use client";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Alerta, ETAPA_LABEL, META, formatear, limiteAlerta } from "@/lib/tipos";
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
    return <p className="text-sm text-ink-3">Sin alertas activas.</p>;

  return (
    <ul className="space-y-2">
      {alertas.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 rounded-ctrl
                                  border border-warn bg-warn/10 p-3 text-sm">
          <div>
            <p className="sc-eyebrow">
              {META[a.variable]?.label ?? a.variable}:{" "}
              {formatear(a.variable, a.ultimoValor)} {META[a.variable]?.unidad}
              {/* v2: una alerta por condición, con cuántas veces se repitió */}
              {typeof a.conteo === "number" && a.conteo > 1 && (
                <span className="ml-2 rounded-ctrl bg-warn/10 px-2 py-0.5 text-[10px]
                                 text-warn">
                  ×{a.conteo}
                </span>
              )}
            </p>
            <p className="text-xs text-ink-2">
              {ETAPA_LABEL[a.etapa] ?? a.etapa} · límite {limiteAlerta(a)} ·
              {" desde "}
              {a.desde?.toDate ? a.desde.toDate().toLocaleTimeString("es-CL") : "—"}
              {a.hasta?.toDate && ` · última ${a.hasta.toDate().toLocaleTimeString("es-CL")}`}
            </p>
          </div>
          {puedeReconocer && (
            <button onClick={() => reconocer(a.id)}
              className="shrink-0 rounded-ctrl bg-brand px-3 py-1 text-xs text-[#06121f]
                         hover:bg-brand-deep">
              Reconocer
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
