"use client";
import { cliente } from "@/lib/mock-cip";
import {
  IconoAjustes, IconoCampana, IconoGlobo, IconoGota, IconoHistorial, IconoOnda,
} from "@/components/ui/Iconos";

const OPERACION = [
  { id: "vivo", label: "Monitoreo en vivo", Icono: IconoOnda },
  { id: "historial", label: "Historial de ciclos", Icono: IconoHistorial },
  { id: "consumos", label: "Consumos", Icono: IconoGota },
  { id: "alertas", label: "Alertas", Icono: IconoCampana, badge: 1 },
];

export default function Sidebar({ activo = "vivo" }: { activo?: string }) {
  return (
    <aside className="cip-sidebar">
      <div className="cip-brand">
        <IconoGlobo />
        <div>
          <div className="cip-brand-name">StormCIP</div>
          <div className="cip-brand-sub">Austral Storm Suite</div>
        </div>
      </div>

      <div className="cip-client">
        <div className="cip-micro">Cliente</div>
        <div className="cip-client-name">{cliente.nombre}</div>
        <div className="cip-client-detail cip-mono">{cliente.detalle}</div>
      </div>

      <nav className="cip-navgroup">
        <div className="cip-micro">Operación</div>
        {OPERACION.map(({ id, label, Icono, badge }) => (
          <button key={id} type="button"
            className={`cip-navitem${id === activo ? " is-active" : ""}`}
            aria-current={id === activo ? "page" : undefined}>
            <Icono />
            <span>{label}</span>
            {badge ? <span className="cip-badge-alert">{badge}</span> : null}
          </button>
        ))}
      </nav>

      <nav className="cip-navgroup">
        <div className="cip-micro">Sistema</div>
        <button type="button" className="cip-navitem">
          <IconoAjustes />
          <span>Configuración</span>
        </button>
      </nav>

      <div className="cip-sidebar-foot">
        <div className="cip-line-state">
          <span className="cip-dot" style={{ background: "var(--green)" }} />
          Línea CIP-01 · en operación
        </div>
        <div className="cip-demo-box cip-micro">Maqueta · datos simulados</div>
        <div className="cip-copyright">{cliente.empresa}</div>
      </div>
    </aside>
  );
}
