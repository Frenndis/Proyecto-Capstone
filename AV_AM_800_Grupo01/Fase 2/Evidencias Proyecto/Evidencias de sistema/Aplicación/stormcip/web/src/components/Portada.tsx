"use client";
// Portada pública: explica qué es un CIP y qué mide Storm CIP antes de entrar a la
// plataforma. Mismos capítulos y animaciones de la presentación de Austral.
import Image from "next/image";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { sinMovimiento } from "@/lib/animacion";
import { nf } from "@/lib/planta";
import { useAuth } from "@/lib/auth-context";
import "@/styles/sala-plataformas.css";
import "@/styles/sala-pagina.css";

const useLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Camión 2 fases: nombre, segundos, °C objetivo y °C mínimo
const CAMION: [string, number, number, number | null][] = [
  ["Preenjuague", 200, 35, null], ["Soda", 450, 70, 65], ["Enjuague", 100, 45, null],
  ["Ácido", 300, 70, 65], ["Enjuague final", 150, 30, null], ["Drenaje", 100, 25, null],
];
const DUR = CAMION.reduce((a, f) => a + f[1], 0);
function tempEn(t: number) {
  let a = 0;
  for (let i = 0; i < CAMION.length; i++) {
    if (t < a + CAMION[i][1] || i === CAMION.length - 1) {
      const previa = i === 0 ? 18 : CAMION[i - 1][2];
      return CAMION[i][2] + (previa - CAMION[i][2]) * Math.exp(-(t - a) / 45) + Math.sin(t / 7) * 0.35;
    }
    a += CAMION[i][1];
  }
  return 25;
}
const xx = (t: number) => (t / DUR) * 1000;
const yy = (v: number) => 292 - (v / 85) * 284;

const TACT = [
  ["T", "Temperatura", "Se mide en el retorno, no en la salida: es lo que realmente llegó al final del circuito.", "temp"],
  ["A", "Acción mecánica", "El caudal se convierte en velocidad. 26 m³/h en línea DN 76 son 1,8 m/s; el mínimo habitual es 1,5 m/s.", "flow"],
  ["C", "Concentración", "La conductividad da el % de soda o ácido. En el enjuague final prueba que no quedó químico.", "conc"],
  ["T", "Tiempo", "Solo cuenta mientras las otras tres están en rango. Si la temperatura cae, el reloj de la fase se detiene.", "plc"],
];

const PROCESOS: { n: string; s: string; lead: string; fases: [string, number, string][]; senales: string[]; agua: string }[] = [
  { n: "Camión cisterna", s: "Recepción de leche", lead: "Se limpia con el camión en el andén y con presión de tiempo: el próximo viaje ya está esperando.", fases: [["Preenjuague", 3.3, "35 °C"], ["Soda 1,3 %", 7.5, "70 °C"], ["Enjuague", 1.7, "45 °C"], ["Ácido 0,6 %", 5, "70 °C"], ["Enjuague final", 2.5, "30 °C"], ["Drenaje", 1.7, ""]], senales: ["Temperatura de retorno", "Conductividad", "Caudal", "Tiempo por fase"], agua: "2.080 L" },
  { n: "Camión, monofase", s: "Una sola etapa química", lead: "Una sola etapa química en lugar de soda y ácido. La telemetría demuestra que la limpieza corta se cumplió.", fases: [["Preenjuague", 1, ""], ["Monofase ácida 0,3 %", 4, "60 °C"], ["Enjuague", 2, ""]], senales: ["Temperatura de retorno", "Conductividad", "Caudal", "Agua por ciclo"], agua: "820 L" },
  { n: "Silos y estanques", s: "Con bola de aspersión", lead: "En un silo importa el caudal por aspersor y que el retorno no se acumule en el fondo.", fases: [["Preenjuague", 8, ""], ["Soda 1,0 %", 20, "70 °C"], ["Enjuague", 6, ""], ["Ácido 0,6 %", 10, "65 °C"], ["Enjuague final", 5, ""]], senales: ["Caudal por aspersor", "Temperatura de retorno", "Conductividad", "Nivel de fondo"], agua: "5.200 L" },
  { n: "Pasteurizador", s: "Intercambiador de placas", lead: "La incrustación de proteína exige más temperatura y más soda; el ácido retira la piedra de leche.", fases: [["Preenjuague", 6, ""], ["Soda 1,5 %", 18, "80 °C"], ["Enjuague", 5, ""], ["Ácido 0,8 %", 6, "65 °C"], ["Enjuague final", 5, ""]], senales: ["Temperatura de retorno", "Conductividad", "Caudal", "Presión diferencial"], agua: "5.920 L" },
  { n: "Tinas de quesería", s: "Ciclo entre lotes", lead: "Es la limpieza que se conecta más directo con el lote siguiente, y la primera que se revisa si un queso sale mal.", fases: [["Preenjuague", 5, ""], ["Soda 1,0 %", 12, "75 °C"], ["Enjuague", 4, ""], ["Ácido 0,5 %", 4, "65 °C"], ["Enjuague final", 4, ""]], senales: ["Temperatura de retorno", "Conductividad", "Tiempo por fase", "Lote siguiente"], agua: "1.420 L" },
  { n: "Llenadoras", s: "Boquillas y tolva", lead: "Último punto antes del envase. Aquí la conductividad del enjuague final también prueba que no quedó químico.", fases: [["Preenjuague", 6, ""], ["Soda 1,0 %", 18, "75 °C"], ["Enjuague", 6, ""], ["Ácido 0,5 %", 6, "65 °C"], ["Enjuague final", 5, ""]], senales: ["Temperatura de retorno", "Conductividad residual", "Caudal", "Tiempo por fase"], agua: "1.650 L" },
];

function Burbuja({ x, y, a, b, v, on }: { x: number; y: number; a: string; b: string; v: string; on: boolean }) {
  return (
    <g className={`p-bub${on ? " is-on" : ""}`}>
      <circle cx={x} cy={y} r={28} />
      <text x={x} y={y - 2} textAnchor="middle" className="p-b1">{a}</text>
      <text x={x} y={y + 14} textAnchor="middle" className="p-b2">{b}</text>
      <text x={x} y={y - 42} textAnchor="middle" className="p-val">{v}</text>
    </g>
  );
}

function Pid({ activo }: { activo: string }) {
  return (
    <svg className="pid" viewBox="0 0 900 600" aria-hidden="true">
      {([["T-01", "Agua rec.", 40], ["T-02", "Soda", 150], ["T-03", "Ácido", 260], ["T-04", "Agua", 370]] as [string, string, number][]).map(([c, n, x]) => (
        <g className="p-tank" key={c}>
          <rect x={x} y={30} width={86} height={104} rx={3} />
          <path d={`M${x + 43} 134V176`} />
          <text x={x + 43} y={76} textAnchor="middle" className="p-t">{n}</text>
          <text x={x + 43} y={96} textAnchor="middle" className="p-t p-t--m">{c}</text>
        </g>
      ))}
      <path className="p-pipe" d="M83 176H540M584 176H650M720 176H852V330" />
      <path className="p-flow" d="M193 176H540M584 176H650M720 176H852V330" />
      <circle cx="562" cy="176" r="22" className="p-eq" /><path d="M552 164L576 176L552 188Z" className="p-eq p-eq--f" />
      <text x="562" y="222" textAnchor="middle" className="p-t p-t--m">P-01</text>
      <rect x="650" y="150" width="70" height="52" className="p-eq" /><path d="M650 150L720 202M720 150L650 202" className="p-eq" />
      <text x="685" y="222" textAnchor="middle" className="p-t p-t--m">HX-01 · vapor</text>
      <rect x="560" y="330" width="320" height="104" rx="4" className="p-cir" />
      <text x="720" y="376" textAnchor="middle" className="p-t p-t--b">Circuito</text>
      <text x="720" y="400" textAnchor="middle" className="p-t p-t--m">camión · silo · pasteurizador · tina · llenadora</text>
      <path className="p-pipe" d="M560 382H83V134" /><path className="p-flow" d="M560 382H83V134" />
      <path className="p-pipe p-pipe--d" d="M180 382V470" /><text x="192" y="462" className="p-t p-t--m">a desagüe</text>
      <circle cx="248" cy="382" r="20" className="p-eq" /><path d="M258 372L238 382L258 392Z" className="p-eq p-eq--f" />
      <rect x="330" y="500" width="330" height="70" rx="3" className={`p-plc${activo === "plc" ? " is-on" : ""}`} />
      <text x="495" y="530" textAnchor="middle" className="p-t p-t--b">PLC central CIP</text>
      <text x="495" y="552" textAnchor="middle" className="p-t p-t--m">{activo === "plc" ? "03:50 de 07:30 · el reloj de la fase" : "receta · reloj de cada fase"}</text>
      <path className="p-sig" d="M470 412V500M372 412V500M780 206V270H524V500" />
      <Burbuja x={470} y={382} a="TT" b="01" v="70,2 °C" on={activo === "temp"} />
      <Burbuja x={372} y={382} a="CT" b="01" v="1,31 %" on={activo === "conc"} />
      <Burbuja x={780} y={176} a="FT" b="01" v="26,0 m³/h" on={activo === "flow"} />
    </svg>
  );
}

export default function Portada() {
  const { user } = useAuth();
  const destino = user ? "/central" : "/login";
  const raiz = useRef<HTMLDivElement>(null);
  const linea = useRef<SVGPolylineElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const cabeza = useRef<HTMLDivElement>(null);
  const valor = useRef<HTMLElement>(null);
  const [paso, setPaso] = useState(0);
  const [proc, setProc] = useState(0);

  useLayout(() => {
    gsap.registerPlugin(ScrollTrigger);
    const dibujar = (p: number) => {
      const T = p * DUR;
      let pts = "";
      for (let t = 0; t < T; t += DUR / 400) pts += `${xx(t).toFixed(1)},${yy(tempEn(t)).toFixed(1)} `;
      const v = tempEn(Math.min(T, DUR - 0.01));
      linea.current?.setAttribute("points", `${pts}${xx(T).toFixed(1)},${yy(v).toFixed(1)}`);
      if (cabeza.current && svg.current) {
        const r = svg.current.getBoundingClientRect(), pr = svg.current.parentElement!.getBoundingClientRect();
        cabeza.current.style.left = `${p * 100}%`;
        cabeza.current.style.top = `${r.top - pr.top + (yy(v) / 300) * r.height}px`;
        cabeza.current.classList.toggle("is-end", p > 0.82);
      }
      if (valor.current) valor.current.textContent = `${nf(v, 1)} °C`;
    };
    if (sinMovimiento()) { dibujar(1); return; }
    const ctx = gsap.context(() => {
      const o = { p: 0 };
      gsap.timeline({ delay: 0.15 })
        .from(".p-cover__t", { yPercent: 18, opacity: 0, duration: 1.2, ease: "power3.out" }, 0)
        .from(".p-cover__side > *", { opacity: 0, duration: 0.9, stagger: 0.12 }, 0.5)
        .from(".trace__phases span", { opacity: 0, duration: 0.5, stagger: 0.08 }, 0.5)
        .to(o, { p: 1, duration: 7, ease: "power1.inOut", onUpdate: () => dibujar(o.p) }, 0.6);
      if (window.innerWidth > 900) {
        ScrollTrigger.create({
          trigger: ".p-tact", pin: ".p-tact__pin", start: "top top", end: () => `+=${TACT.length * window.innerHeight * 0.9}`,
          onUpdate: (s) => setPaso(Math.min(TACT.length - 1, Math.floor(s.progress * TACT.length))),
        });
      }
      gsap.utils.toArray<HTMLElement>("[data-revela]").forEach((el) => {
        gsap.from(el, { opacity: 0, y: 24, duration: 0.9, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 85%" } });
      });
    }, raiz);
    return () => ctx.revert();
  }, []);

  // Las barras de fase crecen al elegir un proceso
  useEffect(() => {
    if (sinMovimiento()) return;
    gsap.fromTo(".proc-d > *", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.06, ease: "power3.out" });
    gsap.fromTo(".pd-bar i", { scaleX: 0, transformOrigin: "0 50%" }, { scaleX: 1, duration: 0.7, stagger: 0.07, ease: "power3.out" });
  }, [proc]);

  const p = PROCESOS[proc];
  const totalMin = p.fases.reduce((a, f) => a + f[1], 0);

  return (
    <div className="land" ref={raiz}>
      <header className="hudl">
        <Image src="/logos/austral-chemicals-color.png" alt="Austral Chemicals" width={150} height={46} style={{ height: 34, width: "auto" }} priority />
        <Link href={destino} className="btn-entrar">{user ? "Ir a la plataforma" : "Entrar"}</Link>
      </header>

      <section className="sec p-cover">
        <div className="p-cover__txt">
          <h1 className="p-cover__t">Cada limpieza,<br />demostrada.</h1>
          <div className="p-cover__side">
            <p className="p-cover__lede">Storm CIP mide cada limpieza industrial de principio a fin, y muestra dónde sobra agua, químico y tiempo.</p>
            <p className="p-cover__meta"><b>Austral Chemicals</b>, 2026. Datos de demostración.</p>
          </div>
        </div>
        <figure className="trace" aria-label="Curva de temperatura de retorno de un ciclo CIP">
          <div className="trace__phases">{CAMION.map(([n, s]) => <span key={n} style={{ flex: s }}>{n}</span>)}</div>
          <svg ref={svg} viewBox="0 0 1000 300" preserveAspectRatio="none">
            {CAMION.map(([n, s, , min], i) => {
              const a = CAMION.slice(0, i).reduce((x, f) => x + f[1], 0);
              return min ? <rect key={n} x={xx(a)} width={xx(s)} y={yy(75)} height={yy(min) - yy(75)} className="trace__band" /> : null;
            })}
            <polyline ref={linea} className="trace__l" fill="none" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="trace__head" ref={cabeza}><i /><b className="mono" ref={valor}>18,0 °C</b></div>
          <figcaption>Temperatura de retorno de un camión cisterna en 22 minutos de limpieza. La banda es el rango que hay que sostener.</figcaption>
        </figure>
      </section>

      <section className="sec p-tact">
        <div className="p-tact__pin">
          <div className="p-tact__copy">
            <h2 className="h2">Una limpieza CIP se valida con cuatro variables.</h2>
            <ol className="tacl">
              {TACT.map(([l, n, d], i) => (
                <li key={n} className={paso === i ? "is-on" : ""}><span className="mono">{l}</span><div><b>{n}</b><p>{d}</p></div></li>
              ))}
            </ol>
          </div>
          <div className="p-tact__stage"><Pid activo={TACT[paso][3]} /></div>
        </div>
      </section>

      <section className="sec p-proc">
        <div className="wrap">
          <div className="p-proc__head" data-revela>
            <h2 className="h2">Todo lo que tenga una señal, se puede demostrar.</h2>
            <p className="note">Recetas de ejemplo. En cada planta se cargan las recetas validadas de cada circuito.</p>
          </div>
          <div className="p-proc__b" style={{ marginTop: 40 }}>
            <div className="proc-l">
              <p className="proc-g">Limpieza CIP</p>
              {PROCESOS.map((x, i) => (
                <button key={x.n} className={i === proc ? "is-on" : ""} onClick={() => setProc(i)}><b>{x.n}</b><span>{x.s}</span></button>
              ))}
            </div>
            <article className="proc-d">
              <header>
                <div><h3>{p.n}</h3><p>{p.lead}</p></div>
                <div className="pd-n"><b className="mono">{nf(totalMin)}</b><span>min por ciclo</span></div>
              </header>
              <div className="pd-bar">
                {p.fases.map(([n, m, t]) => (
                  <div key={n} style={{ flex: m }} className={/%/.test(n) ? "is-chem" : ""}><i /><b title={n}>{n}</b><span className="mono">{t}</span></div>
                ))}
              </div>
              <div className="pd-s">
                <div><p className="pd-l">Señales que se leen</p><ul>{p.senales.map((s) => <li key={s}>{s}</li>)}</ul></div>
                <div><p className="pd-l">Agua por ciclo</p><p className="pd-v mono">{p.agua}</p></div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="sec p-q">
        <div className="wrap">
          <h2 className="h2" data-revela>Tres preguntas, una sola plataforma.</h2>
          <ol className="tl3" data-revela>
            <li><span className="tl3__when"><b className="mono">En vivo</b> durante la limpieza</span><h3>¿Se hizo bien?</h3><p>Temperatura, concentración, caudal y tiempo de cada fase, contra su receta.</p></li>
            <li><span className="tl3__when"><b className="mono">Al cerrar</b> el ciclo</span><h3>¿Se puede liberar?</h3><p>Un registro generado desde los datos, sin digitación, listo para la auditoría.</p></li>
            <li><span className="tl3__when"><b className="mono">Cada mes</b> con la historia</span><h3>¿Dónde sobra?</h3><p>Qué enjuague termina tarde, qué dosis está alta y cuánta agua se ahorra si se corrige.</p></li>
          </ol>
        </div>
      </section>

      <section className="sec p-arq">
        <div className="wrap">
          <h2 className="h2" data-revela>Se lee del proceso.<br />No se escribe en él.</h2>
          <div className="arq" data-revela>
            <section><p className="arq__t">En la planta</p><ul><li>PLC de la central CIP<small>Según la marca de cada planta</small></li><li>Sensores LoRaWAN<small>Dragino: pH, conductividad y caudal</small></li></ul></section>
            <section><p className="arq__t">Red</p><ul><li>Gateway Milesight UG65<small>Solo lectura: el control sigue en el PLC</small></li><li>The Things Stack<small>Servidor de red LoRaWAN</small></li></ul></section>
            <section><p className="arq__t">Storm CIP</p><ul><li>Cloud Functions<small>Valida, calcula y predice</small></li><li>Cloud Firestore<small>Datos en tiempo real</small></li></ul></section>
            <section><p className="arq__t">Quién lo usa</p><ul><li>Calidad<small>Validación y decisiones de receta</small></li><li>Producción<small>Liberación de circuitos</small></li><li>Mantención<small>Vapor, sensores, fugas</small></li><li>Gerencia<small>Cumplimiento y consumos</small></li></ul></section>
          </div>
        </div>
      </section>

      <section className="sec cierre">
        <Image src="/logos/austral-chemicals-blanco.png" alt="Austral Chemicals" width={170} height={52} style={{ height: 44, width: "auto" }} />
        <h2 className="h2" style={{ color: "#E8F0F8", maxWidth: "18ch" }} data-revela>La misma limpieza, de principio a fin.</h2>
        <Link href={destino} className="btn-entrar">{user ? "Ir a la plataforma" : "Entrar a Storm CIP"}</Link>
      </section>
    </div>
  );
}
