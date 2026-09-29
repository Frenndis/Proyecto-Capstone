# StormCIP — pruebas locales con emuladores

Pasos para probar `ttnUplink` (webhook TTN → decoder WQS-LB → Firestore) contra
los emuladores de Firebase, sin cuenta real de The Things Stack.

## Prerrequisitos

- Node 20+, Firebase CLI (`npm install -g firebase-tools` o `npx firebase-tools`).
- Java (los emuladores de Firestore/Auth lo necesitan). Si PowerShell no lo
  encuentra en el PATH (`firebase emulators:start` falla con un error de Java
  aunque esté instalado), probar desde `cmd.exe` en vez de PowerShell — puede
  resolver el PATH de forma distinta.

## 1) Setup único

`TTN_WEBHOOK_SECRET` se define con `defineSecret` (Secret Manager) en
`lorawanAdapter.ts`, no como variable de entorno plana. En local, el emulador
de Functions lee el valor desde `functions/.secret.local` (mismo formato
`CLAVE=valor` que un `.env`; no se sube a git). Crear ese archivo con:

```
TTN_WEBHOOK_SECRET=test-secret
```

Este valor debe coincidir con el que usa `scripts/simulador-ttn.js` (por
defecto, también `test-secret`). (Para el proyecto real de producción, el
secreto se configura distinto — ver `DESPLIEGUE.md`.)

Instalar dependencias si no se hizo antes:

```powershell
cd functions; npm install
cd ..\scripts; npm install
```

## 2) Levantar los emuladores

**Desde `stormcip/`** (la carpeta con `firebase.json`), no desde `functions/`:

```powershell
firebase emulators:start --project stormcip-dev
```

No usar `npm run serve` dentro de `functions/` para esto: solo levanta el
emulador de Functions, no Firestore/Auth/UI que también hacen falta para la
prueba completa.

El proyecto (`stormcip-dev`) tiene que coincidir con el que usan
`scripts/seed.js` y `scripts/simulador-ttn.js` (`scripts/config.js` es la
única fuente de verdad para ese ID; se puede sobreescribir con la variable de
entorno `PROJECT_ID`).

Anotar del log de arranque:
- La URL de `ttnUplink` (algo como `http://127.0.0.1:5001/stormcip-dev/southamerica-west1/ttnUplink`).
- La URL de la Emulator UI (por defecto `http://127.0.0.1:4000`), para inspeccionar Firestore.

## 3) Seed y simulador

En otra terminal, dentro de `scripts/`:

```powershell
npm run seed
npm run sim:ttn
```

`npm run sim:ttn` corre 5 casos contra `ttnUplink`:

1. **Uplink válido** (pH, EC_K10, turbidez, firmware 1.2) → 200, crea una lectura.
2. **pH fuera de rango físico** (>14) → 200 `ignorado` (rechazado por `procesarLectura`, no escribe nada).
3. **Dispositivo desconocido** → 200 `ignorado`.
4. **FPort=5** → 200 `ignorado` (no se decodifica como lectura).
5. **Idempotencia**: el mismo payload con el mismo `received_at`, enviado dos
   veces. Debe generar **una sola** lectura (mismo `lecturaId` en ambos envíos:
   el segundo pisa al primero, no lo duplica).

## 4) Verificar en la Emulator UI

En la pestaña Firestore:
- `ciclos/CIP-2026-0001/lecturas`: después del caso 5 debe haber un único doc
  nuevo con ID `0011223344556677_1790424000` (segundos de `RECEIVED_AT_FIJO`
  en `simulador-ttn.js`), no dos.
- `alertas`: si el ciclo tenía algún umbral activo para la etapa vigente,
  tampoco debe haber alertas duplicadas para esa misma lectura.

Por defecto el ciclo del seed arranca en la etapa `preenjuague`, que no tiene
umbral de `ph` configurado — con esa configuración el caso 5 no genera
alertas, solo prueba que la lectura no se duplique. Para además verificar que
las **alertas** tampoco se duplican (como en la prueba manual: pH, temperatura
y turbidez fuera de umbral), antes de correr `npm run sim:ttn` editar a mano
en la Emulator UI el documento `ciclos/CIP-2026-0001` y cambiar `etapaActual`
de `"preenjuague"` a `"alcalino"` (ese umbral sí tiene `ph: {min: 11.5}`, y el
payload de prueba trae pH 7.00).
