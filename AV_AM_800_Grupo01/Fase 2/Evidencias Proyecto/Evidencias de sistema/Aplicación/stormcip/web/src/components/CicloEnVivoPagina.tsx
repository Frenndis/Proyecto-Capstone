"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { detenerCiclo, iniciarCiclo, useCiclosPlanta } from "@/hooks/usePlanta";
import { useAuth } from "@/lib/auth-context";
import VistaCiclo from "@/components/VistaCiclo";
import { Ic } from "@/components/ui/Ic";
import { gsap, useEntrada } from "@/lib/animacion";
import { NOMBRES_CIRCUITO, PLANO } from "@/lib/planta";

function Pagina() {
  const { rol } = useAuth();
  const { ciclos, cargando } = useCiclosPlanta(40);
  const pedido = useSearchParams().get("circuito");
  const [circuito, setCircuito] = useState(pedido ?? "and2");
  const [escenario, setEscenario] = useState("normal");
  const [iniciando, setIniciando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (pedido) setCircuito(pedido); }, [pedido]);

  // Primero lo que está en curso; si no hay, el último cierre del circuito elegido
  const enCurso = ciclos.find((c) => c.estado === "en_curso");
  const mostrado = enCurso ?? ciclos.find((c) => c.circuitoId === circuito && c.estado === "finalizado") ?? ciclos.find((c) => c.estado === "finalizado");
  const puede = rol === "admin" || rol === "operador";

  useEffect(() => { if (enCurso) setIniciando(false); }, [enCurso]);

  const iniciar = async () => {
    setIniciando(true); setError("");
    try {
      await iniciarCiclo(circuito, escenario);
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? "No se pudo iniciar el ciclo.");
    } finally { setIniciando(false); }
  };

  const raiz = useEntrada<HTMLElement>((el) => {
    gsap.fromTo(el.children, { opacity: 0 }, { opacity: 1, duration: 0.5, stagger: 0.07 });
  }, [mostrado?.id]);

  return (
    <section className="v v-vivo" ref={raiz}>
      <div className="card lv-ctrl">
        <Ic n="pulse" />
        {enCurso ? (
          <>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Ciclo en curso en {enCurso.circuito}</span>
            {puede && <button className="btn2" style={{ marginLeft: "auto" }} onClick={() => detenerCiclo(enCurso.id)}><Ic n="stop" />Detener</button>}
          </>
        ) : (
          <>
            <label>Circuito
              <select value={circuito} onChange={(e) => setCircuito(e.target.value)} disabled={iniciando}>
                {PLANO.nodos.map((n) => <option key={n.id} value={n.id}>{NOMBRES_CIRCUITO[n.id]}</option>)}
              </select>
            </label>
            <label>Escenario
              <select value={escenario} onChange={(e) => setEscenario(e.target.value)} disabled={iniciando}>
                <option value="normal">Ciclo normal</option>
                <option value="desvio">Con caída de temperatura</option>
              </select>
            </label>
            <button className="btn2 btn2--pri" onClick={iniciar} disabled={!puede || iniciando}>
              <Ic n="play" />{iniciando ? "Iniciando…" : "Iniciar ciclo de demostración"}
            </button>
            <span style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: "auto" }}>
              {error || (puede ? "Corre en la nube, a 20× de velocidad." : "Solo operación puede iniciar un ciclo.")}
            </span>
          </>
        )}
      </div>
      {mostrado ? <VistaCiclo key={mostrado.id} ciclo={mostrado} />
        : <p className="card pcard pcard__p">{cargando ? "Leyendo ciclos…" : "Aún no hay ciclos. Inicia uno de demostración."}</p>}
    </section>
  );
}

export default function CicloEnVivoPagina() {
  return <Suspense><Pagina /></Suspense>;
}
