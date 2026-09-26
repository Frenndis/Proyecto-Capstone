# StormCIP — contexto para Claude Code

Monitoreo de líneas CIP con sensores de calidad de agua Dragino WQS-LB (LoRaWAN), The Things Stack, Firebase Cloud Functions y Firestore sobre GCP.

## Estructura (rutas relativas a esta carpeta)

- `Aplicación/stormcip/` — la aplicación (Firebase).
  - `functions/src/` — Cloud Functions en TypeScript (`ingest.ts`, `lorawanAdapter.ts`, `types.ts`, `auth.ts`, `index.ts`).
  - `scripts/` — `seed.js`, `simulador.js`, `simulador-ttn.js`.
  - `web/` — frontend.
- `Base de datos/modelo-datos-sensores.md` — diseño del modelo de datos Firestore.
- `Informacion Tecnica Sensores/WQS-LB/` — manual, datasheet, firmware y changelog del sensor.

Las rutas tienen espacios y tildes: en la terminal, siempre entre comillas.

## Sensores WQS-LB

- La fuente de verdad del formato de bytes es `Informacion Tecnica Sensores/WQS-LB/WQS-LB-LS.pdf` junto con `Firmware/changelog.txt`.
- El formato del payload depende de la versión de firmware (ver tabla en `Base de datos/TAREAS-DECODER-WQS.md`). No usar `decoded_payload` de TTN ni el decoder de GitHub de Dragino: corresponde al firmware 1.1 o anterior.
- Validar siempre el largo del payload antes de interpretarlo.
- No inventar formatos de payload no documentados. Ante la duda, devolver "formato no soportado" y conservar el payload crudo.

## Forma de trabajo

- Proponer un plan y esperar aprobación antes de modificar código.
- Una tarea a la vez, con tests.
- No modificar `firestore.rules` sin pedirlo explícitamente.
