// Lógica pura del botón "Iniciar simulación" de la demo. Sin React ni Firestore.
// El protocolo (documentos, reglas y decisión del simulador) está en
// functions/src/simulacion/controlSimulacion.ts y en firestore.rules.

export type Escenario = "normal" | "falla";
export const ESCENARIOS: Escenario[] = ["normal", "falla"];
export const ETIQUETA_ESCENARIO: Record<Escenario, string> = { normal: "Normal", falla: "Falla" };

/** Sin que cambie el contador del latido por más de esto, el simulador se da por apagado. */
export const VIVO_MS = 15_000;
/** Una orden sin respuesta del simulador por más de esto se da por perdida. */
export const RESPUESTA_MAX_MS = 15_000;

/** Documento simulacionEstado/{linea} tal como lo escribe el simulador. */
export type EstadoSimulador = {
  latido?: number;
  estado?: "libre" | "ejecutando";
  cicloId?: string | null;
  escenario?: Escenario | null;
  ultimaSolicitudId?: string | null;
  ultimoRechazo?: string | null;
};

// ── Latido ────────────────────────────────────────────────────
/**
 * El simulador está vivo si su contador `latido` cambió hace menos de VIVO_MS
 * según el reloj de ESTE navegador. No se compara con la hora del servidor: así un
 * reloj mal puesto no puede dar un falso "apagado" ni un falso "activo".
 * Al cargar la página no se conoce el momento del último cambio: hasta ver el
 * primer cambio (≤ 5 s) se considera apagado, nunca vivo por defecto.
 */
export type SeguimientoLatido = { ultimoLatido: number | null; cambioMs: number | null };
export const SIN_LATIDO: SeguimientoLatido = { ultimoLatido: null, cambioMs: null };

export function seguirLatido(
  previo: SeguimientoLatido, latidoActual: number | undefined, ahoraMs: number,
): SeguimientoLatido {
  if (typeof latidoActual !== "number") return SIN_LATIDO;
  if (previo.ultimoLatido === null) return { ultimoLatido: latidoActual, cambioMs: null };
  if (latidoActual !== previo.ultimoLatido) return { ultimoLatido: latidoActual, cambioMs: ahoraMs };
  return previo;
}

export function latidoVivo(s: SeguimientoLatido, ahoraMs: number, vivoMs = VIVO_MS): boolean {
  return s.cambioMs !== null && ahoraMs - s.cambioMs < vivoMs;
}

// ── Órdenes ───────────────────────────────────────────────────
export type Pendiente = { solicitudId: string; enviadaMs: number };

/** Campos de la orden salvo `solicitadoEn` (lo pone el servidor con serverTimestamp). */
export function armarOrden(
  comando: "iniciar" | "detener", escenario: Escenario | null, solicitudId: string, uid: string,
) {
  return {
    comando, solicitudId, solicitadoPor: uid,
    ...(comando === "iniciar" && escenario ? { escenario } : {}),
  };
}

export type ResultadoOrden =
  | { tipo: "esperando" }
  | { tipo: "aceptada" }
  | { tipo: "rechazada"; motivo: string }
  | { tipo: "sin_respuesta" };

/** Qué pasó con la última orden enviada, mirando el estado que publica el simulador. */
export function resultadoDeOrden(
  pendiente: Pendiente | null, estado: EstadoSimulador | undefined, ahoraMs: number,
): ResultadoOrden | null {
  if (!pendiente) return null;
  if (estado?.ultimaSolicitudId === pendiente.solicitudId) {
    return estado.ultimoRechazo
      ? { tipo: "rechazada", motivo: estado.ultimoRechazo }
      : { tipo: "aceptada" };
  }
  return ahoraMs - pendiente.enviadaMs > RESPUESTA_MAX_MS ? { tipo: "sin_respuesta" } : { tipo: "esperando" };
}

// ── Botón ─────────────────────────────────────────────────────
export type EstadoBoton = {
  puedeIniciar: boolean;
  puedeDetener: boolean;
  /** Por qué no se puede iniciar (null si se puede). */
  motivoIniciar: string | null;
};

/**
 * Habilitación de los botones. Es comodidad de la interfaz: la garantía de un solo
 * ciclo por línea está en la transacción de crearCiclo del simulador.
 *  - Iniciar: simulador vivo, libre, sin ciclo en curso en la línea y sin orden en vuelo.
 *  - Detener: simulador vivo y con una simulación en marcha.
 */
export function estadoBoton({
  vivo, estado, cicloEnCursoId, esperandoRespuesta,
}: {
  vivo: boolean; estado: EstadoSimulador | undefined;
  cicloEnCursoId: string | null; esperandoRespuesta: boolean;
}): EstadoBoton {
  const ejecutando = estado?.estado === "ejecutando";
  const puedeDetener = vivo && ejecutando && !esperandoRespuesta;
  let motivoIniciar: string | null = null;
  if (!vivo) motivoIniciar = "El simulador está apagado (no hay latido)";
  else if (esperandoRespuesta) motivoIniciar = "Esperando la respuesta del simulador";
  else if (ejecutando) motivoIniciar = "Hay una simulación en curso";
  else if (cicloEnCursoId) motivoIniciar = `La línea ya tiene un ciclo en curso (${cicloEnCursoId})`;
  return { puedeIniciar: motivoIniciar === null, puedeDetener, motivoIniciar };
}
