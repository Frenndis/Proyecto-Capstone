"use client";
// Navegacion del panel. "Configuracion" solo existe para admin; mientras el
// token no resolvio el rol se muestra un placeholder, nunca se asume "no admin".
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { IconoAjustes, IconoHistorial, IconoOnda } from "@/components/ui/Iconos";
import type { Rol } from "@/lib/tipos";

type Item = {
  href: string;
  label: string;
  Icono: (p: { size?: number }) => React.ReactElement;
  /** Si se indica, el item solo aparece para estos roles. */
  roles?: Rol[];
};

export const NAV: Item[] = [
  { href: "/monitoreo", label: "Monitoreo", Icono: IconoOnda },
  { href: "/historial", label: "Historial", Icono: IconoHistorial },
  { href: "/configuracion", label: "Configuración", Icono: IconoAjustes, roles: ["admin"] },
];

export default function SidebarNav() {
  const pathname = usePathname();
  const { rol, cargando } = useAuth();

  return (
    <nav className="shell-nav">
      <div className="shell-micro">Operación</div>
      {NAV.map(({ href, label, Icono, roles }) => {
        if (roles) {
          // El rol todavia no resolvio: reservar el espacio sin revelar ni negar.
          if (cargando) return <div key={href} className="shell-navitem-skeleton" aria-hidden />;
          if (!rol || !roles.includes(rol)) return null;
        }
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
