import { defineConfig } from "vitest/config";

// Tests de firestore.rules contra el emulador de Firestore (debe estar corriendo,
// por defecto en 127.0.0.1:8080). Ver `npm run test:reglas`.
export default defineConfig({
  test: {
    include: ["reglas/**/*.test.ts"],
    // Un solo archivo a la vez: comparten el emulador
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
