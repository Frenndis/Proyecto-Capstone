"use client";
// Indicador de conexion del header. En esta fase solo refleja la conectividad
// del navegador; cuando el monitoreo lea Firestore en vivo, el estado pasa a
// derivarse de la antiguedad de la ultima lectura recibida.
import { useEffect, useState } from "react";

export default function EstadoConexion() {
  // Arranca en null para no desajustar la hidratacion: el HTML exportado no
  // sabe si el navegador esta en linea.
  const [enLinea, setEnLinea] = useState<boolean | null>(null);

  useEffect(() => {
    const leer = () => setEnLinea(navigator.onLine);
    leer();
    window.addEventListener("online", leer);
    window.addEventListener("offline", leer);
    return () => {
      window.removeEventListener("online", leer);
      window.removeEventListener("offline", leer);
    };
  }, []);

  const texto = enLinea === null ? "Verificando…" : enLinea ? "En línea" : "Sin conexión";
  const color = enLinea === null ? "text-ink-3" : enLinea ? "text-ok" : "text-crit";

  return (
    <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold ${color}`} role="status">
      <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {texto}
    </span>
  );
}
