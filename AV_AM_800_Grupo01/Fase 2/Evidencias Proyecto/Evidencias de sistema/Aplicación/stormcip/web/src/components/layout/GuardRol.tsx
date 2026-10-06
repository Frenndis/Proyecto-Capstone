"use client";
// Guard de rol del lado del cliente: el hosting es estatico (output: "export"),
// asi que no hay middleware donde cortar la navegacion antes de servir la pagina.
// Sin sesion manda a /login; con sesion pero sin el rol pedido muestra un aviso
// (redirigir a /dashboard podria dejar en bucle a quien tampoco tiene acceso ahi).
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import type { Rol } from "@/lib/tipos";

export default function GuardRol({
  roles,
  children,
}: {
  roles: Rol[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, rol, cargando, salir } = useAuth();
  const permitido = !!rol && roles.includes(rol);

  useEffect(() => {
    // Solo decidir cuando el token ya resolvio: antes de eso no se sabe el rol.
    if (!cargando && !user) router.replace("/login");
  }, [cargando, user, router]);

  if (cargando || !user) return <p className="p-6 text-slate-500">Cargando…</p>;

  if (!permitido) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-3 rounded-2xl border border-slate-200 p-6 dark:border-slate-700">
          <h1 className="text-lg font-semibold">Sin permisos</h1>
          <p className="text-sm text-slate-500">
            Tu cuenta ({user.email}) tiene rol <b>{rol ?? "sin rol"}</b> y esta página
            requiere: {roles.join(", ")}. Pide a un administrador que te asigne el rol.
          </p>
          <button onClick={salir} className="rounded-lg border px-3 py-1 text-sm">Salir</button>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
