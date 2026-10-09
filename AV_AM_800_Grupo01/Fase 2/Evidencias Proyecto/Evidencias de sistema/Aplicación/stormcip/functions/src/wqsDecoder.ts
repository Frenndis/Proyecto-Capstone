/**
 * Decoder propio para el WQS-LB (Dragino), FPort 2/3/5.
 *
 * Fuente de verdad: `Informacion Tecnica Sensores/WQS-LB/Firmware/WQS-LB-payload-extracto.md`
 * (transcripción de las secciones 2.2/2.3 del manual) y `.../WQS-LB/Firmware/changelog.txt`.
 * No usar el decoder oficial de Dragino en GitHub como referencia: corresponde a
 * firmware 1.1 o anteriores y no soporta las temperaturas por sonda de 1.2+.
 *
 * El formato de flags de 2 bytes de firmware >= 1.3.1 no está documentado en el
 * manual: cualquier payload de esa versión devuelve error en vez de adivinar el
 * mapa de bits (ver Tarea 1, regla 4 de TAREAS-DECODER-WQS.md).
 */

// ---------- Tipos de resultado ----------

export type EstadoDispositivo = {
  modelo: number;
  firmware: string;
  banda: string;
  subBanda: number;
  bateriaV: number;
};

export type LecturaTiempoReal = {
  bateriaV: number;
  tempExterna: number | null;
  turbidez?: number;
  oxigenoDisuelto?: number;
  doTemp?: number | null;
  orp?: number;
  ecK10?: number;
  ecK10Temp?: number | null;
  ecK1?: number;
  ecK1Temp?: number | null;
  ph?: number;
  phTemp?: number | null;
  /** true si no se recibió `firmware` y el formato se determinó probando A y B contra el largo del payload. */
  formatoInferido?: boolean;
};

export type RegistroDatalog = {
  turbidez?: number;
  oxigenoDisuelto?: number;
  orp?: number;
  ecK10?: number;
  ecK1?: number;
  ph?: number;
  sinAck: boolean;
  timestamp: number;
};

export type WqsDecodeResult =
  | { ok: true; fPort: 5; datos: EstadoDispositivo }
  | { ok: true; fPort: 2; datos: LecturaTiempoReal }
  | { ok: true; fPort: 3; datos: RegistroDatalog[] }
  | { ok: false; error: string; raw: { hex: string; fPort: number } };

// ---------- Punto de entrada ----------

export function decodeWqs(bytes: Uint8Array, fPort: number, firmware?: string): WqsDecodeResult {
  switch (fPort) {
    case 5:
      return decodeFPort5(bytes);
    case 2:
      return decodeFPort2(bytes, firmware);
    case 3:
      return decodeFPort3(bytes, firmware);
    default:
      return err(`formato no soportado: FPort ${fPort} no reconocido`, bytes, fPort);
  }
}

// ---------- FPort 5: estado del dispositivo ----------

const BANDAS: Record<number, string> = {
  0x01: "EU868", 0x02: "US915", 0x03: "IN865", 0x04: "AU915", 0x05: "KZ865",
  0x06: "RU864", 0x07: "AS923", 0x08: "AS923-1", 0x09: "AS923-2", 0x0a: "AS923-3",
  0x0b: "CN470", 0x0c: "EU433", 0x0d: "KR920", 0x0e: "MA869",
};

function decodeFPort5(bytes: Uint8Array): WqsDecodeResult {
  if (bytes.length !== 7) {
    return err(`formato no soportado: FPort 5 esperaba 7 bytes, recibió ${bytes.length}`, bytes, 5);
  }
  const modelo = bytes[0];
  const firmware = decodeFirmwareBytes(bytes[1], bytes[2]);
  const bandaCodigo = bytes[3];
  const banda = BANDAS[bandaCodigo] ?? `desconocida(0x${bandaCodigo.toString(16)})`;
  const subBanda = bytes[4];
  const bateriaV = leerUint16(bytes, 5) / 1000;
  return ok(5, { modelo, firmware, banda, subBanda, bateriaV });
}

/**
 * 0x0100 -> "1.0.0" es el ÚNICO ejemplo del manual (extracto, sección 2.2.1).
 * Que el byte bajo sea "minor en el nibble alto, patch en el bajo"
 * (0x0120 -> "1.2.0", 0x0133 -> "1.3.3") es una SUPOSICIÓN a partir de ese
 * ejemplo: se confirma con el primer FPort 5 real (ver modelo-datos-sensores.md).
 */
function decodeFirmwareBytes(hi: number, lo: number): string {
  const major = hi;
  const minor = (lo >> 4) & 0x0f;
  const patch = lo & 0x0f;
  return `${major}.${minor}.${patch}`;
}

// ---------- Versión de firmware: clasificación de formato ----------

export type Version = { major: number; minor: number; patch: number };

/** "1.2" → 1.2.0; los segmentos que faltan o no son numéricos valen 0. */
export function parseFirmware(firmware: string): Version {
  const [major = 0, minor = 0, patch = 0] = firmware.split(".").map((n) => Number(n) || 0);
  return { major, minor, patch };
}

export function compararVersion(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

const V1_2_0: Version = { major: 1, minor: 2, patch: 0 };
const V1_3_1: Version = { major: 1, minor: 3, patch: 1 };
const V1_3_3: Version = { major: 1, minor: 3, patch: 3 };

/** Familia de formato de FPort 2: A < 1.2, B 1.2–1.3.0, C ≥ 1.3.1 (no soportada). */
export type FormatoFPort2 = "A" | "B" | "C";

function clasificarFormatoFPort2(v: Version): FormatoFPort2 {
  if (compararVersion(v, V1_2_0) < 0) return "A";
  if (compararVersion(v, V1_3_1) < 0) return "B";
  return "C";
}

/**
 * Familia de formato que decodeWqs usa para un firmware dado. Es la misma
 * regla que elige el decoder de FPort 2; se exporta para comparar el firmware
 * registrado de un equipo con el que reporta en su uplink de estado (FPort 5).
 */
export function familiaFormatoFirmware(firmware: string): FormatoFPort2 {
  return clasificarFormatoFPort2(parseFirmware(firmware));
}

// ---------- FPort 2: lectura en tiempo real ----------

/**
 * Orden fijo de sondas según el byte/flag de FPort=2 y FPort=3 (extracto 2.2.2/2.3.4):
 * bit 5 turbidez, 4 oxígeno disuelto, 3 ORP, 2 EC_K10, 1 EC_K1, 0 pH.
 * `multiplicador` ya incluye la dirección (÷ o ×) para poder hacer `raw * multiplicador`.
 * `campoTemp` es el nombre del campo de temperatura asociado (solo EC_K10, EC_K1, pH en formato B).
 */
type CampoSonda = {
  bit: number;
  campo: "turbidez" | "oxigenoDisuelto" | "orp" | "ecK10" | "ecK1" | "ph";
  multiplicador: number;
  signed: boolean;
  campoTemp?: "doTemp" | "ecK10Temp" | "ecK1Temp" | "phTemp";
};

const SONDAS: CampoSonda[] = [
  { bit: 5, campo: "turbidez", multiplicador: 0.1, signed: false },
  { bit: 4, campo: "oxigenoDisuelto", multiplicador: 0.01, signed: false, campoTemp: "doTemp" },
  { bit: 3, campo: "orp", multiplicador: 1, signed: true },
  { bit: 2, campo: "ecK10", multiplicador: 10, signed: false, campoTemp: "ecK10Temp" },
  { bit: 1, campo: "ecK1", multiplicador: 1, signed: false, campoTemp: "ecK1Temp" },
  { bit: 0, campo: "ph", multiplicador: 0.01, signed: false, campoTemp: "phTemp" },
];

const SENTINEL_TEMP_DESCONECTADA = 0x0ccc;

function decodeFPort2(bytes: Uint8Array, firmwareStr?: string): WqsDecodeResult {
  if (bytes.length < 5) {
    return err(`formato no soportado: FPort 2 esperaba al menos 5 bytes, recibió ${bytes.length}`, bytes, 2);
  }

  // (valor & 0x3FFF): máscara defensiva, no está en el extracto (solo dice BAT/1000);
  // no cambia ningún ejemplo conocido porque el voltaje nunca alcanza 0x3FFF. Confirmar
  // con un uplink real si esto llega a importar.
  const bateriaV = (leerUint16(bytes, 0) & 0x3fff) / 1000;

  const tempRaw = leerUint16(bytes, 2);
  const tempExterna = tempRaw === SENTINEL_TEMP_DESCONECTADA ? null : escalar(tempRaw, 0.1, true);

  const flagByte = bytes[4];
  const presentes = SONDAS.filter((s) => (flagByte & (1 << s.bit)) !== 0);
  const base = { bateriaV, tempExterna };
  const restante = bytes.length - 5;

  const formato = firmwareStr ? familiaFormatoFirmware(firmwareStr) : undefined;

  if (formato === "C") {
    return err("formato no soportado: firmware >= 1.3.1 usa flag de 2 bytes sin documentar", bytes, 2);
  }

  if (formato === "A") {
    const datos = intentarFormatoA(bytes, presentes, restante);
    if (!datos) {
      return err(
        `formato no soportado: largo esperado ${5 + presentes.length * 2}, recibido ${bytes.length}`,
        bytes,
        2,
      );
    }
    return ok(2, { ...base, ...datos });
  }

  if (formato === "B") {
    const datos = intentarFormatoB(bytes, presentes, restante);
    if (!datos) {
      return err(`formato no soportado: ningún largo de formato 1.2.x calza con ${bytes.length} bytes`, bytes, 2);
    }
    return ok(2, { ...base, ...datos });
  }

  // Sin firmware conocido: probar B y luego A: usar el que calce con el largo del payload.
  const datosB = intentarFormatoB(bytes, presentes, restante);
  if (datosB) {
    return ok(2, { ...base, ...datosB, formatoInferido: true });
  }
  const datosA = intentarFormatoA(bytes, presentes, restante);
  if (datosA) {
    return ok(2, { ...base, ...datosA, formatoInferido: true });
  }
  return err(
    `formato no soportado: sin firmware conocido y el largo (${bytes.length}) no calza con formato A ni B`,
    bytes,
    2,
  );
}

function intentarFormatoA(
  bytes: Uint8Array,
  presentes: CampoSonda[],
  restante: number,
): Partial<LecturaTiempoReal> | null {
  const largoEsperado = presentes.length * 2;
  if (restante !== largoEsperado) return null;
  const datos: Partial<LecturaTiempoReal> = {};
  let offset = 5;
  for (const s of presentes) {
    datos[s.campo] = escalar(leerUint16(bytes, offset), s.multiplicador, s.signed);
    offset += 2;
  }
  return datos;
}

function intentarFormatoB(
  bytes: Uint8Array,
  presentes: CampoSonda[],
  restante: number,
): Partial<LecturaTiempoReal> | null {
  const doPresente = presentes.some((s) => s.campo === "oxigenoDisuelto");
  // EC_K10, EC_K1 y pH siempre llevan su temperatura en formato B (mandatorio);
  // la de oxígeno disuelto es la hipótesis que se está probando, así que se
  // cuenta aparte según `conDoTemp`.
  const largoTempMandatorio =
    presentes.filter((s) => s.campoTemp && s.campo !== "oxigenoDisuelto").length * 2;
  for (const conDoTemp of doPresente ? [false, true] : [false]) {
    const largoEsperado = presentes.length * 2 + largoTempMandatorio + (conDoTemp ? 2 : 0);
    if (largoEsperado !== restante) continue;

    const datos: Partial<LecturaTiempoReal> = {};
    let offset = 5;
    for (const s of presentes) {
      datos[s.campo] = escalar(leerUint16(bytes, offset), s.multiplicador, s.signed);
      offset += 2;
      if (s.campoTemp) {
        if (s.campo === "oxigenoDisuelto" && !conDoTemp) {
          datos.doTemp = null;
        } else {
          datos[s.campoTemp] = escalar(leerUint16(bytes, offset), 0.1, true);
          offset += 2;
        }
      }
    }
    return datos;
  }
  return null;
}

// ---------- FPort 3: datalog ----------

function decodeFPort3(bytes: Uint8Array, firmwareStr?: string): WqsDecodeResult {
  if (firmwareStr) {
    const v = parseFirmware(firmwareStr);
    if (compararVersion(v, V1_3_3) >= 0) {
      return err("formato no soportado: firmware >= 1.3.3 eliminó el datalog", bytes, 3);
    }
  }
  if (bytes.length === 0 || bytes.length % 11 !== 0) {
    return err(`formato no soportado: largo de datalog no es múltiplo de 11 (${bytes.length})`, bytes, 3);
  }

  const registros: RegistroDatalog[] = [];
  for (let i = 0; i < bytes.length; i += 11) {
    const registro = bytes.subarray(i, i + 11);
    if (registro.every((b) => b === 0)) continue;

    const flags = registro[6];
    const bitsPresentes = flags & 0x3f;
    const presentes = SONDAS.filter((s) => (bitsPresentes & (1 << s.bit)) !== 0);
    if (presentes.length > 3) {
      return err("formato no soportado: registro de datalog con más de 3 sondas marcadas", bytes, 3);
    }

    const datos: Partial<RegistroDatalog> = {};
    let offset = 0;
    for (const s of presentes) {
      datos[s.campo] = escalar(leerUint16(registro, offset), s.multiplicador, s.signed);
      offset += 2;
    }
    const sinAck = (flags & 0x80) !== 0;
    const timestamp =
      ((registro[7] << 24) | (registro[8] << 16) | (registro[9] << 8) | registro[10]) >>> 0;

    registros.push({ ...datos, sinAck, timestamp } as RegistroDatalog);
  }
  return ok(3, registros);
}

// ---------- Helpers de lectura/escala ----------

function leerUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function toSigned16(raw: number): number {
  return raw >= 0x8000 ? raw - 0x10000 : raw;
}

function escalar(raw: number, multiplicador: number, signed: boolean): number {
  const valor = signed ? toSigned16(raw) : raw;
  return Math.round(valor * multiplicador * 1e6) / 1e6;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function ok(fPort: 5, datos: EstadoDispositivo): WqsDecodeResult;
function ok(fPort: 2, datos: LecturaTiempoReal): WqsDecodeResult;
function ok(fPort: 3, datos: RegistroDatalog[]): WqsDecodeResult;
function ok(fPort: number, datos: unknown): WqsDecodeResult {
  return { ok: true, fPort, datos } as WqsDecodeResult;
}

function err(mensaje: string, bytes: Uint8Array, fPort: number): WqsDecodeResult {
  return { ok: false, error: mensaje, raw: { hex: bytesToHex(bytes), fPort } };
}
