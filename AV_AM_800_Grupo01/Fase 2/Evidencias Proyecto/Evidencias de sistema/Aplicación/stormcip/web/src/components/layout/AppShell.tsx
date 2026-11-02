"use client";
// Armazón de la maqueta Storm CIP: barra lateral de la suite y barra superior.
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useCiclosHoy, useOportunidades } from "@/hooks/usePlanta";
import GuardRol from "./GuardRol";
import { Ic, IconoNombre } from "@/components/ui/Ic";

const NAV: { href: string; label: string; icono: IconoNombre; titulo?: string }[] = [
  { href: "/central", label: "Central CIP", icono: "dash" },
  { href: "/dashboard", label: "Ciclo en vivo", icono: "pulse" },
  { href: "/registros", label: "Registros de ciclo", icono: "file" },
  { href: "/consumos", label: "Consumos", icono: "drop", titulo: "Consumos de limpieza" },
  { href: "/prediccion", label: "Predicción y ahorro", icono: "spark" },
  { href: "/reportes", label: "Reportes", icono: "chart", titulo: "Reporte para gerencia" },
];
const SISTEMA: typeof NAV = [
  { href: "/sensores", label: "Sensores WQS-LB", icono: "chip", titulo: "Sensores de la línea piloto" },
  { href: "/configuracion", label: "Recetas y límites", icono: "grid" },
];
const ROL: Record<string, string> = { admin: "Administrador", operador: "Operador", visor: "Visor" };

function Reloj() {
  const [ahora, setAhora] = useState("");
  useEffect(() => {
    const leer = () => {
      const d = new Date();
      setAhora(`${d.toLocaleDateString("es-CL")} ${d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false })}`);
    };
    leer();
    const id = setInterval(leer, 15000);
    return () => clearInterval(id);
  }, []);
  return <span className="tb__clock mono">{ahora}</span>;
}

function Marco({ children }: { children: React.ReactNode }) {
  const ruta = usePathname().replace(/\/$/, "");
  const { user, rol, salir } = useAuth();
  const { ciclos } = useCiclosHoy();
  const { oportunidades } = useOportunidades();
  const todos = [...NAV, ...SISTEMA];
  const actual = todos.find((n) => n.href === ruta);
  const enCurso = ciclos.filter((c) => c.estado === "en_curso").length;
  const alertas = (oportunidades?.decisiones ?? []).filter((d) => d.tipo === "revisar_circuito" || d.tipo === "posible_fuga").length;

  const enlace = (n: (typeof NAV)[number]) => (
    <Link key={n.href} href={n.href} className={ruta === n.href ? "is-on" : ""} aria-current={ruta === n.href ? "page" : undefined}>
      <Ic n={n.icono} /><span>{n.label}</span>
      {n.href === "/dashboard" && enCurso > 0 && <i className="dot" style={{ background: "#2FB7E8" }} />}
      {n.href === "/prediccion" && (oportunidades?.decisiones.length ?? 0) > 0 && <em style={{ color: "#7AD0F0" }}>{oportunidades!.decisiones.length}</em>}
    </Link>
  );

  return (
    <div className="app app--pagina">
      <aside className="sb">
        <div className="sb__head">
          <span className="sb__logo"><Image src="/logos/austral-globe.png" alt="" width={26} height={26} /></span>
          <div><b>Storm CIP</b><span className="mono">Austral Chemicals</span></div>
        </div>
        <nav className="sb__nav">
          {NAV.map(enlace)}
          <p className="sb__group">Sistema</p>
          {SISTEMA.map(enlace)}
        </nav>
        <div className="sb__foot">
          <span className="sb__av mono">{user?.email?.slice(0, 2).toUpperCase()}</span>
          <div><b title={user?.email ?? ""}>{user?.email}</b><span>{rol ? ROL[rol] ?? rol : "Sin rol"}</span></div>
          <button className="sb__salir" onClick={salir}>Salir</button>
        </div>
      </aside>
      <div className="mn">
        <header className="tb">
          <span className="tb__ic">{actual && <Ic n={actual.icono} />}</span>
          <div className="tb__txt">
            <p className="tb__crumbs"><span>Storm CIP</span><Ic n="chev" /><span>Planta demo · Lácteos</span></p>
            <h1 className="tb__title">{actual?.titulo ?? actual?.label ?? "Storm CIP"}</h1>
          </div>
          <div className="tb__right">
            <span className="demo-chip">Datos de demostración</span>
            <span className={`sc ${enCurso ? "sc--accent" : "sc--ok"}`}><i className={enCurso ? "pulse" : ""} /><span>{enCurso ? `${enCurso} ciclo en curso` : "8 circuitos en línea"}</span></span>
            <Reloj />
            <Link href="/prediccion" className="tb__bell" title="Alertas que requieren decisión">
              <Ic n="bell" />{alertas > 0 && <b className="mono">{alertas}</b>}
            </Link>
          </div>
        </header>
        <div className="views">{children}</div>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return <GuardRol roles={["admin", "operador", "visor"]}><Marco>{children}</Marco></GuardRol>;
}
