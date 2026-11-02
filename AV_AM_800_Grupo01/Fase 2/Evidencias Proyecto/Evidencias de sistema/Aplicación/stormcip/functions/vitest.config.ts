import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // "lib" es la salida compilada de `tsc` (ver package.json, outDir): sin este
    // exclude, Vitest también corre los .test.js ya compilados ahí y fallan
    // porque son CommonJS (Vitest requiere ESM/TS de origen).
    // "reglas" necesita el emulador de Firestore corriendo: se ejecuta aparte
    // con `npm run test:reglas`, para que `npm test` no dependa del emulador.
    exclude: ["node_modules/**", "lib/**", "reglas/**"],
  },
});
