// Iconos inline: el proyecto no tiene librería de iconos instalada y para seis
// trazos simples no vale la pena agregar una dependencia.

type P = { size?: number };

const base = (size: number) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.6,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
});

export function IconoGlobo({ size = 22 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
    </svg>
  );
}

export function IconoOnda({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M2 12h3l3 7 4-16 3 9h2.5l1.5-3H22" />
    </svg>
  );
}

export function IconoHistorial({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function IconoGota({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M12 3.5c3.5 4 5.5 6.6 5.5 9.3A5.5 5.5 0 0 1 12 18.3a5.5 5.5 0 0 1-5.5-5.5c0-2.7 2-5.3 5.5-9.3Z" />
    </svg>
  );
}

export function IconoCampana({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 15Z" />
      <path d="M10 20h4" />
    </svg>
  );
}

export function IconoAjustes({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M3 7h18M3 12h18M3 17h18" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}
