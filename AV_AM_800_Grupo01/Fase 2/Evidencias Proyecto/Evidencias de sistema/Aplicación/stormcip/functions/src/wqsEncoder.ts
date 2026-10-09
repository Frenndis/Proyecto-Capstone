/**
 * Encoder WQS-LB (Dragino): inverso de wqsDecoder para FPort 2, formato B
 * (firmware 1.2.x), con la configuración de sondas de este proyecto:
 * DR-TS1 (turbidez), DR-ECK10.0 (EC_K10 + temperatura), DR-PH01 (pH +
 * temperatura) y el DS18B20 externo.
 *
 * Solo lo usa el simulador (scripts/simulador-cip.js) para que las lecturas
 * entren por el mismo camino que un uplink real: frm_payload → ttnUplink →
 * decodeWqs → procesarLectura. No se usa en producción con equipos reales.
 *
 * Estructura (ver wqsDecoder.ts, decodeFPort2 / intentarFormatoB):
 *   BAT (2) | TEMP_EXT (2) | FLAG (1) | por cada sonda presente, en orden de
 *   bit descendente: valor (2) [+ temperatura (2) si la sonda la lleva]
 */

export type DatosWqsFPort2 = {
  bateriaV: number;
  /** null = DS18B20 desconectado (se codifica con el centinela 0x0CCC). */
  tempExterna: number | null;
  turbidez?: number;
  ecK10?: number;
  ecK10Temp?: number;
  ph?: number;
  phTemp?: number;
};

const SENTINEL_TEMP_DESCONECTADA = 0x0ccc;

// Bits del flag y escalas: los mismos que SONDAS en wqsDecoder.ts.
const BIT_TURBIDEZ = 5;
const BIT_EC_K10 = 2;
const BIT_PH = 0;

export function encodeWqsFPort2(d: DatosWqsFPort2): Uint8Array {
  const out: number[] = [];
  let flag = 0;

  escribirUint16(out, Math.round(d.bateriaV * 1000), "bateriaV");
  if (d.tempExterna === null) {
    escribirUint16(out, SENTINEL_TEMP_DESCONECTADA, "tempExterna");
  } else {
    escribirInt16(out, Math.round(d.tempExterna * 10), "tempExterna");
  }
  const posFlag = out.length;
  out.push(0); // se completa al final

  // Orden fijo por bit descendente: turbidez (5), EC_K10 (2), pH (0)
  if (d.turbidez !== undefined) {
    flag |= 1 << BIT_TURBIDEZ;
    escribirUint16(out, Math.round(d.turbidez * 10), "turbidez");
  }
  if (d.ecK10 !== undefined) {
    flag |= 1 << BIT_EC_K10;
    escribirUint16(out, Math.round(d.ecK10 / 10), "ecK10");
    escribirInt16(out, Math.round(requerido(d.ecK10Temp, "ecK10Temp") * 10), "ecK10Temp");
  }
  if (d.ph !== undefined) {
    flag |= 1 << BIT_PH;
    escribirUint16(out, Math.round(d.ph * 100), "ph");
    escribirInt16(out, Math.round(requerido(d.phTemp, "phTemp") * 10), "phTemp");
  }

  out[posFlag] = flag;
  return Uint8Array.from(out);
}

// En formato B la temperatura de EC_K10 y pH es obligatoria: sin ella el
// largo del payload no calza y el decoder lo rechaza.
function requerido(v: number | undefined, campo: string): number {
  if (v === undefined) throw new Error(`${campo} es obligatorio en formato B`);
  return v;
}

function escribirUint16(out: number[], raw: number, campo: string) {
  if (!Number.isInteger(raw) || raw < 0 || raw > 0xffff) {
    throw new Error(`${campo} fuera de rango para 16 bits sin signo (${raw})`);
  }
  out.push((raw >> 8) & 0xff, raw & 0xff);
}

function escribirInt16(out: number[], raw: number, campo: string) {
  if (!Number.isInteger(raw) || raw < -0x8000 || raw > 0x7fff) {
    throw new Error(`${campo} fuera de rango para 16 bits con signo (${raw})`);
  }
  // El valor real 327.6 °C coincide con el centinela del DS18B20: no se permite
  if (campo === "tempExterna" && raw === SENTINEL_TEMP_DESCONECTADA) {
    throw new Error("tempExterna 327.6 °C coincide con el centinela de desconectado");
  }
  escribirUint16(out, raw < 0 ? raw + 0x10000 : raw, campo);
}
