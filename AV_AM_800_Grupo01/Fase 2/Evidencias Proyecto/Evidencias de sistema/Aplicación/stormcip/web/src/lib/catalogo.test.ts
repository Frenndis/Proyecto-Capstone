import { describe, expect, it } from "vitest";
import { CATALOGO_SONDAS } from "./catalogo";
// El catálogo de la web es una copia (ver catalogo.ts): este test falla si se desfasa.
import { CATALOGO_SONDAS as CATALOGO_BACKEND } from "../../../functions/src/types";

describe("CATALOGO_SONDAS de la web", () => {
  it("es idéntico al de functions/src/types.ts", () => {
    expect(CATALOGO_SONDAS).toEqual(CATALOGO_BACKEND);
  });
});
