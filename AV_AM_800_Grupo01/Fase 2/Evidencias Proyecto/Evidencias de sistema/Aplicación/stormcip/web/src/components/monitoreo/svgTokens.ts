// Los atributos de presentación SVG no aceptan var(--x), así que la paleta del
// diagrama se repite aquí como literales. Debe seguir a monitoreo.css.
export const C = {
  bgTank: "#0a1826",
  bgNode: "#0e2438",
  panel: "#0b1a2b",
  border: "#1a354c",
  text: "#e8f0f7",
  secondary: "#93a7ba",
  muted: "#62788d",
  cyan: "#1bb9e8",
  green: "#23c69b",
  yellow: "#d39c29",
  magenta: "#d84a86",
  line: "#9cb4ca",
};

export const TONOS = {
  yellow: { stroke: C.yellow, fill: "#4a3a16" },
  magenta: { stroke: C.magenta, fill: "#4a1f33" },
  cyan: { stroke: C.cyan, fill: "#123c52" },
};

export const MONO = '"IBM Plex Mono", "Roboto Mono", ui-monospace, monospace';
export const SANS = 'Inter, "IBM Plex Sans", system-ui, sans-serif';
