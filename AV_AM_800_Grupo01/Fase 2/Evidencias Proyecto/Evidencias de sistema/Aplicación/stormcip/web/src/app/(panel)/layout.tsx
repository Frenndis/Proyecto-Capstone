// Layout comun de las vistas del panel (Monitoreo, Historial, Configuracion).
// El grupo de rutas "(panel)" no aparece en la URL: las vistas siguen en
// /monitoreo, /historial y /configuracion.
import "@/styles/shell.css";
import AppShell from "@/components/layout/AppShell";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
