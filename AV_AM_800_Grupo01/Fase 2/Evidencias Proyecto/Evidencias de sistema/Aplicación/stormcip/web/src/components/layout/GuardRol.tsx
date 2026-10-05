"use client";
// Guard de rol del lado del cliente: el hosting es estatico (output: "export"),
// asi que no hay middleware donde cortar la navegacion antes de servir la pagina.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import type { Rol } from "@/lib/tipos";

export default function GuardRol({
  roles,
  children,
  redirigirA = "/monitoreo",
}: {
  roles: Rol[];
  children: React.ReactNode;
  redirigirA?: string;
}) {
  const router = useRouter();
  const { rol, cargando } = useAuth();
  const permitido = !!rol && roles.includes(rol);

  useEffect(() => {
    // Solo decidir cuando el token ya resolvio: antes de eso no se sabe el rol.
    if (!cargando && !permitido) router.replace(redirigirA);
  }, [cargando, permitido, redirigirA, router]);

  if (cargando || !permitido) {
    return (
      <div className="shell-loading" role="status">
        <span className="shell-spinner" aria-hidden />
        {cargando ? "Verificando permisos…" : "Redirigiendo…"}
      </div>
    );
  }

  return <>{children}</>;
}
