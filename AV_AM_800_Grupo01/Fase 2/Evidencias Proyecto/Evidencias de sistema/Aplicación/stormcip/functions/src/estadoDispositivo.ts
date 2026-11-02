// Uplink de estado del WQS-LB (FPort 5): modelo, firmware, banda y batería.
// Se envía al unirse a la red y cada 12 horas (manual, 2.2.1). No pertenece a
// un ciclo: no crea lecturas ni exige un ciclo en curso.
//
// Sirve para saber qué firmware tiene REALMENTE el equipo: el decoder elige el
// formato de FPort 2 con el campo `firmware` que se registró a mano, y si no
// coincide con el del equipo las lecturas se rechazan o se decodifican mal.
// Por eso aquí solo se GUARDA lo reportado (`firmwareReportado`); el campo
// `firmware` que usa el decoder no se toca nunca.
import { Timestamp } from "firebase-admin/firestore";
import {
  EstadoDispositivo, FormatoFPort2, compararVersion, familiaFormatoFirmware, parseFirmware,
} from "./wqsDecoder";

/** Sensor Model del WQS-LB (manual, 2.2.1). */
export const MODELO_WQS_LB = 0x3c;

const DESCRIPCION_FAMILIA: Record<FormatoFPort2, string> = {
  A: "A (< 1.2)", B: "B (1.2 a 1.3.0)", C: "C (≥ 1.3.1, no soportado)",
};

export type AvisoEstado = {
  /** "warn" va a console.warn; "info" a console.info. */
  nivel: "warn" | "info";
  codigo: "modelo_invalido" | "sin_registro" | "familia_distinta" | "version_distinta";
  mensaje: string;
};

/** Campos que se escriben en dispositivos/{id} (sin `firmware`, ni `ultimoPing`: lo agrega el llamador). */
export type EstadoGuardado = {
  firmwareReportado: string;
  banda: string;
  subBanda: number;
  bateriaV: number;
  estadoRecibidoEn: Timestamp;
};

export type PlanEstado = {
  /** null = no se guarda nada. */
  guardar: EstadoGuardado | null;
  avisos: AvisoEstado[];
};

const VERSION_VALIDA = /^\d+(\.\d+){0,2}$/;

/**
 * Qué guardar y qué avisar ante un uplink de estado ya decodificado.
 *
 *  - Modelo distinto de 0x3C: aviso y no se guarda nada.
 *  - Firmware registrado vs. reportado, comparados por FAMILIA DE FORMATO del
 *    decoder (A < 1.2, B 1.2–1.3.0, C ≥ 1.3.1), la misma regla que usa
 *    decodeWqs:
 *      · familia distinta → aviso fuerte (lecturas rechazadas o mal decodificadas);
 *      · misma familia, versión distinta → aviso informativo;
 *      · sin firmware registrado → pide registrarlo.
 *
 * Función pura (sin Firestore): se puede testear sin emulador.
 */
export function planificarEstado(
  datos: EstadoDispositivo, firmwareRegistrado: string | undefined, recibidoEn: Timestamp,
): PlanEstado {
  if (datos.modelo !== MODELO_WQS_LB) {
    return {
      guardar: null,
      avisos: [{
        nivel: "warn", codigo: "modelo_invalido",
        mensaje: `el uplink de estado trae el modelo 0x${datos.modelo.toString(16).padStart(2, "0")}, ` +
                 `no 0x${MODELO_WQS_LB.toString(16)} (WQS-LB): no se guarda nada`,
      }],
    };
  }

  const avisos: AvisoEstado[] = [];
  const registrado = firmwareRegistrado?.trim();
  const reportado = datos.firmware;

  if (!registrado || !VERSION_VALIDA.test(registrado)) {
    avisos.push({
      nivel: "warn", codigo: "sin_registro",
      mensaje: registrado
        ? `el firmware registrado ("${registrado}") no es una versión interpretable; el equipo reporta ` +
          `${reportado}: registrar firmware en dispositivos/{id}`
        : `el dispositivo no tiene firmware registrado; el equipo reporta ${reportado} ` +
          `(formato ${DESCRIPCION_FAMILIA[familiaFormatoFirmware(reportado)]}): registrar firmware en dispositivos/{id}`,
    });
  } else {
    const famRegistrada = familiaFormatoFirmware(registrado);
    const famReportada = familiaFormatoFirmware(reportado);
    if (famRegistrada !== famReportada) {
      avisos.push({
        nivel: "warn", codigo: "familia_distinta",
        mensaje: `FIRMWARE INCOMPATIBLE: registrado ${registrado} (formato ${DESCRIPCION_FAMILIA[famRegistrada]}), ` +
                 `el equipo reporta ${reportado} (formato ${DESCRIPCION_FAMILIA[famReportada]}). ` +
                 "Las lecturas se rechazarán o se decodificarán mal; instalar 1.2.x",
      });
    } else if (compararVersion(parseFirmware(registrado), parseFirmware(reportado)) !== 0) {
      avisos.push({
        nivel: "info", codigo: "version_distinta",
        mensaje: `firmware registrado ${registrado}, el equipo reporta ${reportado} ` +
                 `(mismo formato ${DESCRIPCION_FAMILIA[famRegistrada]})`,
      });
    }
  }

  return {
    guardar: {
      firmwareReportado: reportado, banda: datos.banda, subBanda: datos.subBanda,
      bateriaV: datos.bateriaV, estadoRecibidoEn: recibidoEn,
    },
    avisos,
  };
}
