// Líneas que el dashboard sabe mostrar. La línea de la demo (cip-sim) existe para
// que la simulación (sim:cip --esperar) nunca se mezcle con el equipo real de
// cip-01: ttnUplink asigna cada lectura al ciclo en curso de la línea de su dispositivo.
export const LINEA_REAL = "cip-01";
export const LINEA_DEMO = "cip-sim";

/** "todas" mantiene el comportamiento original: el ciclo en curso de cualquier línea. */
export type SeleccionLinea = "todas" | "real" | "demo";
export const SELECCIONES: SeleccionLinea[] = ["todas", "real", "demo"];
export const SELECCION_DEFECTO: SeleccionLinea = "todas";

export const ETIQUETA_SELECCION: Record<SeleccionLinea, string> = {
  todas: "Todas las líneas",
  real: `Planta (${LINEA_REAL})`,
  demo: `Demo (${LINEA_DEMO})`,
};

/** Línea a consultar para una selección; undefined = sin filtro. */
export function lineaDe(sel: SeleccionLinea): string | undefined {
  return sel === "real" ? LINEA_REAL : sel === "demo" ? LINEA_DEMO : undefined;
}

/** Lo guardado en el navegador puede ser cualquier cosa: valor desconocido → el por defecto. */
export function leerSeleccion(valor: string | null | undefined): SeleccionLinea {
  return SELECCIONES.includes(valor as SeleccionLinea) ? (valor as SeleccionLinea) : SELECCION_DEFECTO;
}

/**
 * Último ciclo finalizado entre los más recientes de una línea (ya ordenados por
 * inicio descendente). Se filtra aquí y no en la consulta para no necesitar un
 * índice compuesto lineaId+estado+inicio: bastan los que ya existen.
 */
export function ultimoFinalizado<T extends { estado?: string }>(ciclosRecientes: T[]): T | null {
  return ciclosRecientes.find((c) => c.estado === "finalizado") ?? null;
}
