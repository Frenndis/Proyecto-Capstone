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

  const clase = enLinea === null ? "" : enLinea ? " is-online" : " is-offline";
  const texto = enLinea === null ? "Verificando…" : enLinea ? "Conectado" : "Sin conexión";

  return (
    <span className={`shell-conn${clase}`} role="status">
      <span className="shell-dot" />
      {texto}
    </span>
  );
}
