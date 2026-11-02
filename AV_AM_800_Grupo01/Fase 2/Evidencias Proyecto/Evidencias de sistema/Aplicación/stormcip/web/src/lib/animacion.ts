"use client";
// GSAP con los mismos plugins y curva de la maqueta. Respeta "reducir movimiento".
import { useEffect, useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";

gsap.registerPlugin(DrawSVGPlugin);
export { gsap };

export const sinMovimiento = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const useLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Corre una animación de entrada en este contenedor y la limpia al desmontar. */
export function useEntrada<T extends HTMLElement | SVGElement>(fn: (raiz: T) => void, deps: unknown[]) {
  const ref = useRef<T>(null);
  useLayout(() => {
    if (!ref.current || sinMovimiento()) return;
    const ctx = gsap.context(() => fn(ref.current as T), ref.current);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Cifra que sube desde cero, como los KPI de la maqueta. */
export function useConteo(valor: number, formato: (n: number) => string) {
  const ref = useRef<HTMLElement>(null);
  const previo = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (sinMovimiento()) { el.textContent = formato(valor); previo.current = valor; return; }
    const o = { n: previo.current };
    const t = gsap.to(o, { n: valor, duration: 0.9, ease: "power2.out", onUpdate: () => { el.textContent = formato(o.n); } });
    previo.current = valor;
    return () => { t.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  return ref;
}
