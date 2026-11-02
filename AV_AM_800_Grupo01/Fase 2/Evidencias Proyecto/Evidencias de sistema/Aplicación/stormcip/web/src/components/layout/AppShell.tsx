"use client";
// Armazón de todas las pantallas: barra lateral con la marca Austral y barra superior.
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useAlertas } from "@/hooks/useDatosCip";
import GuardRol from "./GuardRol";
import EstadoConexion from "./EstadoConexion";
import {
  IconoAjustes, IconoCampana, IconoCentral, IconoGota, IconoHistorial, IconoOnda, IconoPrediccion,
} from "@/components/ui/Iconos";

const NAV = [
  { href: "/central", label: "Central CIP", Icono: IconoCentral },
  { href: "/dashboard", label: "Ciclo en vivo", Icono: IconoOnda },
  { href: "/registros", label: "Registros de ciclo", Icono: IconoHistorial },
  { href: "/consumos", label: "Consumos", Icono: IconoGota },
  { href: "/prediccion", label: "Predicción", Icono: IconoPrediccion },
];

const TITULOS: Record<string, string> = Object.fromEntries(
  [...NAV, { href: "/configuracion", label: "Configuración" }].map((n) => [n.href, n.label]),
);

const ROL_LABEL: Record<string, string> = { admin: "Administrador", operador: "Operador", visor: "Visor" };

function Reloj() {
  const [ahora, setAhora] = useState<string | null>(null);
  useEffect(() => {
    const leer = () => setAhora(new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }));
    leer();
    const id = setInterval(leer, 15000);
    return () => clearInterval(id);
  }, []);
  return <span className="rounded-ctrl border border-line-2 px-2.5 py-1 font-mono text-[12.5px] text-ink-2">{ahora ?? "--:--"}</span>;
}

function Enlace({ href, label, Icono, activo }: { href: string; label: string; Icono: typeof IconoOnda; activo: boolean }) {
  return (
    <Link href={href} aria-current={activo ? "page" : undefined}
      className={`relative flex items-center gap-2.5 rounded-ctrl px-2.5 py-2 text-[13px] font-medium transition-colors ${
        activo ? "bg-raise text-ink" : "text-ink-2 hover:bg-raise/60"}`}>
      {activo && <span className="absolute -left-2.5 bottom-2 top-2 w-0.5 bg-accent" />}
      <span className={activo ? "text-accent" : "text-ink-3"}><Icono size={17} /></span>
      {label}
    </Link>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, rol, salir } = useAuth();
  const alertas = useAlertas();
  const titulo = TITULOS[pathname.replace(/\/$/, "")] ?? "Storm CIP";

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="flex flex-col border-b border-line bg-sidebar lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-3.5">
          <span className="grid h-9 w-9 place-items-center rounded-ctrl border border-line-2">
            <Image src="/logos/austral-globe.png" alt="" width={26} height={26} />
          </span>
          <div>
            <b className="block text-sm font-bold tracking-tight">Storm CIP</b>
            <span className="block font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">Austral Chemicals</span>
          </div>
        </div>
        <nav className="flex flex-row flex-wrap gap-0.5 px-2.5 py-3 lg:flex-1 lg:flex-col">
          {NAV.map((n) => (
            <Enlace key={n.href} {...n} activo={pathname.replace(/\/$/, "") === n.href} />
          ))}
          <p className="sc-eyebrow mx-2.5 mb-1.5 mt-4 hidden lg:block">Sistema</p>
          <Enlace href="/configuracion" label="Configuración" Icono={IconoAjustes}
            activo={pathname.replace(/\/$/, "") === "/configuracion"} />
        </nav>
        <div className="flex items-center gap-2.5 border-t border-line px-3.5 py-3">
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border border-line-2 bg-raise text-[11px] font-semibold uppercase">
            {user?.email?.[0] ?? "?"}
          </span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[12.5px] font-semibold" title={user?.email ?? undefined}>{user?.email}</b>
            <span className="text-[11.5px] text-ink-3">{rol ? ROL_LABEL[rol] ?? rol : "Sin rol"}</span>
          </div>
          <button onClick={salir} className="shrink-0 text-[11.5px] text-ink-3 hover:text-ink">Salir</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-paper px-5">
          <div className="min-w-0">
            <p className="text-xs text-ink-3">Storm CIP</p>
            <h1 className="truncate text-[15px] font-bold tracking-tight">{titulo}</h1>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <EstadoConexion />
            <Reloj />
            <Link href="/central" title="Alertas activas" className="relative text-ink-3 hover:text-ink">
              <IconoCampana size={18} />
              {alertas.length > 0 && (
                <b className="absolute -right-2.5 -top-2 font-mono text-[10.5px] font-semibold text-crit">{alertas.length}</b>
              )}
            </Link>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-5">{children}</main>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <GuardRol roles={["admin", "operador", "visor"]}>
      <Marco>{children}</Marco>
    </GuardRol>
  );
}
