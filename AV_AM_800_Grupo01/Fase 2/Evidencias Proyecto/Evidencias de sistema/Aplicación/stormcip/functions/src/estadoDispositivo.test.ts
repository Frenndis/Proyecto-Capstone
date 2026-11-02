import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { MODELO_WQS_LB, planificarEstado } from "./estadoDispositivo";
import { EstadoDispositivo, decodeWqs } from "./wqsDecoder";

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

/** Uplink FPort 5 decodificado con el decoder real. */
function estado(hex: string): EstadoDispositivo {
  const r = decodeWqs(hexToBytes(hex), 5);
  if (!r.ok || r.fPort !== 5) throw new Error(`no decodificó: ${JSON.stringify(r)}`);
  return r.datos;
}

const RECIBIDO = Timestamp.fromMillis(Date.UTC(2026, 9, 9, 14, 0, 0));

// Ejemplo del manual (2.2.1): WQS-LB, firmware 1.0.0, EU868, sub-banda 0, 3,528 V
const MANUAL = estado("3C010001000DC8");
// Equipo comprado: firmware 1.2.0, AU915 (0x04), sub-banda 2, 3,6 V
const FW_1_2_0 = estado("3C012004020E10");
const FW_1_3_3 = estado("3C013304020E10");

const codigos = (datos: EstadoDispositivo, registrado?: string) =>
  planificarEstado(datos, registrado, RECIBIDO).avisos.map((a) => a.codigo);

describe("planificarEstado — qué se guarda", () => {
  it("con el ejemplo del manual guarda firmwareReportado, banda, subBanda, bateriaV y la hora", () => {
    const plan = planificarEstado(MANUAL, "1.0.0", RECIBIDO);
    expect(plan.guardar).toEqual({
      firmwareReportado: "1.0.0", banda: "EU868", subBanda: 0, bateriaV: 3.528,
      estadoRecibidoEn: RECIBIDO,
    });
    expect(plan.avisos).toEqual([]);
  });

  it("firmware 1.2.0 en AU915", () => {
    expect(planificarEstado(FW_1_2_0, "1.2", RECIBIDO).guardar).toEqual({
      firmwareReportado: "1.2.0", banda: "AU915", subBanda: 2, bateriaV: 3.6,
      estadoRecibidoEn: RECIBIDO,
    });
  });

  // El decoder de FPort 2 elige el formato con `firmware`: el estado nunca lo pisa
  it("nunca incluye el campo firmware del dispositivo", () => {
    for (const reg of ["1.2", "1.3.3", undefined]) {
      expect(planificarEstado(FW_1_3_3, reg, RECIBIDO).guardar).not.toHaveProperty("firmware");
    }
  });
});

describe("planificarEstado — modelo", () => {
  it("modelo distinto de 0x3C: aviso y no se guarda nada", () => {
    const otro = { ...FW_1_2_0, modelo: 0x3d };
    const plan = planificarEstado(otro, "1.2", RECIBIDO);
    expect(plan.guardar).toBeNull();
    expect(plan.avisos).toHaveLength(1);
    expect(plan.avisos[0]).toMatchObject({ nivel: "warn", codigo: "modelo_invalido" });
    expect(plan.avisos[0].mensaje).toMatch(/0x3d.*0x3c/);
  });

  it("0x3C es el WQS-LB", () => {
    expect(MODELO_WQS_LB).toBe(0x3c);
    expect(MANUAL.modelo).toBe(MODELO_WQS_LB);
  });
});

describe("planificarEstado — firmware registrado vs. reportado, por familia de formato", () => {
  it('"1.2" registrado y el equipo reporta 1.2.0: misma versión, sin avisos', () => {
    expect(codigos(FW_1_2_0, "1.2")).toEqual([]);
  });

  it('"1.2" vs 1.3.3: familia distinta (C), aviso fuerte con la instrucción de instalar 1.2.x', () => {
    const plan = planificarEstado(FW_1_3_3, "1.2", RECIBIDO);
    expect(plan.avisos).toHaveLength(1);
    expect(plan.avisos[0]).toMatchObject({ nivel: "warn", codigo: "familia_distinta" });
    expect(plan.avisos[0].mensaje).toMatch(/INCOMPATIBLE.*registrado 1\.2.*reporta 1\.3\.3/);
    expect(plan.avisos[0].mensaje).toMatch(/rechazarán o se decodificarán mal; instalar 1\.2\.x/);
    // Igual se guarda lo reportado: es justo lo que permite saberlo
    expect(plan.guardar?.firmwareReportado).toBe("1.3.3");
  });

  // 1.3.0 todavía es formato B: el decoder lo lee igual que 1.2
  it('"1.2" vs 1.3.0: misma familia (B), sin aviso fuerte, solo informativo', () => {
    const f130 = { ...FW_1_2_0, firmware: "1.3.0" };
    const plan = planificarEstado(f130, "1.2", RECIBIDO);
    expect(plan.avisos.map((a) => a.codigo)).toEqual(["version_distinta"]);
    expect(plan.avisos[0].nivel).toBe("info");
    expect(plan.avisos.some((a) => a.codigo === "familia_distinta")).toBe(false);
  });

  it('"1.2" vs 1.1.0: familia distinta (A), aviso fuerte', () => {
    const f110 = { ...FW_1_2_0, firmware: "1.1.0" };
    expect(codigos(f110, "1.2")).toEqual(["familia_distinta"]);
  });

  it("registrado 1.2.0 y el equipo reporta 1.2.1: misma familia, informativo", () => {
    const f121 = { ...FW_1_2_0, firmware: "1.2.1" };
    const plan = planificarEstado(f121, "1.2.0", RECIBIDO);
    expect(plan.avisos).toEqual([expect.objectContaining({ nivel: "info", codigo: "version_distinta" })]);
  });

  it("sin firmware registrado: pide registrarlo, con lo que reporta el equipo", () => {
    for (const reg of [undefined, "", "   "]) {
      const plan = planificarEstado(FW_1_3_3, reg, RECIBIDO);
      expect(plan.avisos).toHaveLength(1);
      expect(plan.avisos[0]).toMatchObject({ nivel: "warn", codigo: "sin_registro" });
      expect(plan.avisos[0].mensaje).toMatch(/no tiene firmware registrado.*registrar firmware/);
      expect(plan.avisos[0].mensaje).toMatch(/1\.3\.3/);
      expect(plan.guardar?.firmwareReportado).toBe("1.3.3");
    }
  });

  // "<COMPLETAR>" de la plantilla de producción se leería como 0.0.0 (familia A)
  it("un firmware registrado que no es una versión (<COMPLETAR>) se trata como sin registro", () => {
    expect(codigos(FW_1_2_0, "<COMPLETAR>")).toEqual(["sin_registro"]);
  });
});
