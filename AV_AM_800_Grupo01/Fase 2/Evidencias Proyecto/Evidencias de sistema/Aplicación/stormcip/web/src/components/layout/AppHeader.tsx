import EstadoConexion from "./EstadoConexion";
import { linea } from "@/lib/linea";

export default function AppHeader() {
  return (
    <header className="shell-header">
      <div className="shell-header-title">
        <b className="shell-mono">{linea.codigo}</b>
        <span>· {linea.descripcion}</span>
      </div>
      <EstadoConexion />
    </header>
  );
}
