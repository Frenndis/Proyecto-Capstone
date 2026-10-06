"use client";
// Navegacion del panel. Independiente de login/dashboard: no lee la sesion ni el rol.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconoAjustes, IconoHistorial, IconoOnda } from "@/components/ui/Iconos";

type Item = {
  href: string;
  label: string;
  Icono: (p: { size?: number }) => React.ReactElement;
};

export const NAV: Item[] = [
  { href: "/monitoreo", label: "Monitoreo", Icono: IconoOnda },
  { href: "/historial", label: "Historial", Icono: IconoHistorial },
  { href: "/configuracion", label: "Configuración", Icono: IconoAjustes },
];

export default function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="shell-nav">
      <div className="shell-micro">Operación</div>
      {NAV.map(({ href, label, Icono }) => {
        const activo = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href}
            className={`shell-navitem${activo ? " is-active" : ""}`}
            aria-current={activo ? "page" : undefined}>
            <Icono />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
