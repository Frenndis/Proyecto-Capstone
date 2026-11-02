// Layout común de las pantallas con sesión. El grupo de rutas "(panel)" no aparece
// en la URL. Los estilos son los de la maqueta Storm CIP de Austral.
import "@/styles/sala-app.css";
import "@/styles/sala-plataformas.css";
import "@/styles/sala-pagina.css";
import AppShell from "@/components/layout/AppShell";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
