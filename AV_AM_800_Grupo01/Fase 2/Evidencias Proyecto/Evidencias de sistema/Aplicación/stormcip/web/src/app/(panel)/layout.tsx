// Layout común de las pantallas con sesión. El grupo de rutas "(panel)" no aparece
// en la URL: las vistas siguen en /central, /dashboard, /registros, etc.
import AppShell from "@/components/layout/AppShell";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
