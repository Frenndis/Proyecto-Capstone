import SidebarNav from "./SidebarNav";
import AppHeader from "./AppHeader";
import { IconoGlobo } from "@/components/ui/Iconos";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <IconoGlobo />
          <div>
            <div className="shell-brand-name">StormCIP</div>
            <div className="shell-brand-sub">Monitoreo CIP</div>
          </div>
        </div>

        <SidebarNav />

        <div className="shell-sidebar-foot">
          <div className="shell-copyright">Austral Chemicals Chile S.A.</div>
        </div>
      </aside>

      <div className="shell-main">
        <AppHeader />
        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
