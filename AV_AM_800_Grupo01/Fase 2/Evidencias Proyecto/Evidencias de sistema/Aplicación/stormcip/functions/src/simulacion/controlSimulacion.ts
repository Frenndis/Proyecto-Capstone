/**
 * Órdenes del botón "Iniciar simulación" del dashboard (sim:cip --esperar).
 *
 * Función pura: sin Firestore ni red. El dashboard escribe una orden en
 * simulacionControl/{lineaId} (las reglas fijan su forma) y el simulador, que es
 * el único que crea ciclos, decide aquí qué hacer con ella. La garantía real de
 * "un solo ciclo en curso por línea" sigue siendo la transacción de crearCiclo en
 * scripts/simulador-cip.js; esto solo evita ejecutar dos veces la misma orden,
 * órdenes viejas y contradictorias.
 */
import { Escenario } from "./modeloCip";

export const COMANDOS = ["iniciar", "detener"] as const;
export type Comando = (typeof COMANDOS)[number];
export const ESCENARIOS: Escenario[] = ["normal", "falla"];

/** Una orden más vieja que esto no se ejecuta (p. ej. quedó escrita con el simulador apagado). */
export const ANTIGUEDAD_MAX_MS = 60_000;

/** Cada cuánto escribe el simulador su latido. */
export const LATIDO_CADA_MS = 5_000;

export type Orden = {
  comando?: unknown;
  escenario?: unknown;
  solicitudId?: unknown;
  solicitadoPor?: unknown;
};

export type EstadoSimulador = {
  estado: "libre" | "ejecutando";
  /** Última orden ya procesada (aceptada o rechazada): sobrevive a un reinicio del simulador. */
  ultimaSolicitudId: string | null;
};

export type Decision =
  | { accion: "ignorar"; motivo: string }
  | { accion: "iniciar"; escenario: Escenario }
  | { accion: "detener" }
  | { accion: "rechazar"; motivo: string };

/**
 * Qué hacer con la orden vigente.
 *  - Sin orden, o ya procesada (misma solicitudId): ignorar, sin dejar rastro.
 *  - Orden mal formada o vencida: rechazar con el motivo (queda en simulacionEstado).
 *  - iniciar con una simulación en marcha, o detener sin ninguna: rechazar.
 * `solicitadoEnMs` es la hora de la orden (servidor); null si aún no se confirma.
 */
export function decidir(
  orden: Orden | null | undefined, estado: EstadoSimulador,
  { ahoraMs, solicitadoEnMs }: { ahoraMs: number; solicitadoEnMs: number | null },
): Decision {
  if (!orden) return { accion: "ignorar", motivo: "sin orden" };
  const id = orden.solicitudId;
  if (typeof id !== "string" || id.length === 0) return { accion: "rechazar", motivo: "orden sin solicitudId" };
  if (id === estado.ultimaSolicitudId) return { accion: "ignorar", motivo: "orden ya procesada" };

  const comando = orden.comando;
  if (comando !== "iniciar" && comando !== "detener") {
    return { accion: "rechazar", motivo: `comando desconocido: ${String(comando)}` };
  }
  // Un serverTimestamp aún sin confirmar llega vacío al primer snapshot local: se espera al siguiente
  if (solicitadoEnMs === null) return { accion: "ignorar", motivo: "orden aún sin hora confirmada" };
  if (ahoraMs - solicitadoEnMs > ANTIGUEDAD_MAX_MS) {
    return { accion: "rechazar", motivo: "orden vencida (más de 60 s)" };
  }

  if (comando === "detener") {
    return estado.estado === "ejecutando"
      ? { accion: "detener" }
      : { accion: "rechazar", motivo: "no hay una simulación en curso" };
  }
  const escenario = orden.escenario;
  if (escenario !== "normal" && escenario !== "falla") {
    return { accion: "rechazar", motivo: `escenario desconocido: ${String(escenario)}` };
  }
  return estado.estado === "libre"
    ? { accion: "iniciar", escenario }
    : { accion: "rechazar", motivo: "ya hay una simulación en curso" };
}

/**
 * Documento simulacionEstado/{lineaId}. Se sobrescribe completo en cada latido, como
 * estadoProceso: el cliente nunca ve una mezcla de dos momentos.
 */
export type DocEstadoSimulador = {
  v: 1;
  lineaId: string;
  /** Contador que sube en cada latido: el dashboard detecta que está vivo sin comparar relojes. */
  latido: number;
  estado: EstadoSimulador["estado"];
  cicloId: string | null;
  escenario: Escenario | null;
  ultimaSolicitudId: string | null;
  /** null si la última orden se aceptó. */
  ultimoRechazo: string | null;
};

export function docEstado(
  base: { lineaId: string; latido: number; ultimaSolicitudId: string | null; ultimoRechazo: string | null },
  ejecutando: { cicloId: string; escenario: Escenario } | null,
): DocEstadoSimulador {
  return {
    v: 1,
    lineaId: base.lineaId,
    latido: base.latido,
    estado: ejecutando ? "ejecutando" : "libre",
    cicloId: ejecutando?.cicloId ?? null,
    escenario: ejecutando?.escenario ?? null,
    ultimaSolicitudId: base.ultimaSolicitudId,
    ultimoRechazo: base.ultimoRechazo,
  };
}
