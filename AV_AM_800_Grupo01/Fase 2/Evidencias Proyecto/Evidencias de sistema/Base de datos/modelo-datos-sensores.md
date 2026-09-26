# Modelo de datos — Ingesta de sensores (StormCIP)

Diseño de la base de datos Firestore para recibir e interpretar lecturas de las sondas físicas Dragino WQS, ampliando el esquema definido en `SPRINT1.md`.

## 1. Topología física

Una unidad **WQS-LB** (transmisor LoRaWAN) conecta de **1 a 3 sondas** por RS485 y sube las lecturas vía LoRaWAN → Network Server → webhook → `POST /api/ingest`. Cada sonda mide una o más variables con su propio rango físico, resolución y precisión (según datasheet Dragino):

| Modelo de sonda | Variable(s) | Rango físico | Resolución | Precisión |
|---|---|---|---|---|
| DR-ECK1.0 | conductividad, temperatura | EC 0–2000 µS/cm (K=1) · Temp -20–60°C | 1 µS/cm · 0.1°C | ±1%FS · ±0.5°C |
| DR-ECK10.0 | conductividad, temperatura | EC 10–20000 µS/cm (K=10) · Temp -20–60°C | 10 µS/cm · 0.1°C | ±1%FS · ±0.5°C |
| DR-EC200 | conductividad, temperatura | EC 1–200000 µS/cm · Temp -5–80°C | 1 µS/cm · 0.1°C | ±1%FS |
| DR-PH01 | ph, temperatura | pH 0–14 · Temp 0–60°C | 0.01 pH · 0.1°C | ±0.15 pH · ±0.5°C |
| DR-ORP1 | orp | -1999–1999 mV | 1 mV | ±3 mV |
| DR-DO1 | oxigenoDisuelto, temperatura | 0–20 mg/L · Temp 0–50°C | 0.01 mg/L · 0.01°C | ±3% · ±0.5°C |
| DR-DO2 (agua salada) | oxigenoDisuelto | 0–20 mg/L | 0.01 mg/L | ±3%FS |
| DR-TS200 | turbidez | 0–200 NTU | 0.1 NTU | ±5%FS |
| DR-TS4000 | turbidez | 0–4000 NTU | 1 NTU | ±5%FS |
| DR-CL-2ML | cloroResidual | 0–2 mg/L | 0.01 mg/L | ±5%FS |
| DR-CL-10ML | cloroResidual | 0–10 mg/L | 0.01 mg/L | ±5%FS |
| DR-COD | cod, turbidez, temperatura | COD 0–500 mg/L · Turbidez 0–200 NTU | 0.1 mg/L · 0.1 NTU | ±5%FS |

`caudal`, `presion` y `nivel` **no provienen de sondas WQS** — son de otra instrumentación de la línea CIP (ya contemplados en el esquema original) y se mantienen sin cambios.

## 2. Cambios al esquema Firestore

### 2.1 `functions/src/types.ts`
- Se agregan a `VARIABLES`: `orp`, `oxigenoDisuelto`, `cloroResidual`, `cod`.
- Nuevo catálogo estático `CATALOGO_SONDAS`: mapea cada modelo de sonda a sus variables con `{ unidad, min, max, resolucion }`, tomado directamente del datasheet. Es código, no colección Firestore, porque son especificaciones fijas de hardware que no cambian en runtime.
- Nuevo tipo `Sonda = { puerto: 1|2|3; modelo: ModeloSonda }`.

### 2.2 `dispositivos/{deviceId}`
Se agrega el campo opcional `sondas: Sonda[]` para modelar que **un `deviceId` = una unidad física WQS-LB** con hasta 3 sondas conectadas:

```json
{
  "plantaId": "frutillar",
  "lineaId": "cip-01",
  "tipo": "wqs-lb",
  "activo": true,
  "apiKeyHash": "...",
  "sondas": [
    { "puerto": 1, "modelo": "DR-PH01" },
    { "puerto": 2, "modelo": "DR-EC200" },
    { "puerto": 3, "modelo": "DR-TS200" }
  ]
}
```

Dispositivos legado (ej. `esp32-01`) sin campo `sondas` mantienen el comportamiento anterior (solo se valida que el valor sea numérico), para no romper compatibilidad.

### 2.3 Validación en `ingestLectura` (`functions/src/ingest.ts`)
Si el dispositivo tiene `sondas` configuradas, además de la validación existente (variable conocida + numérica), se valida:
1. **Pertenencia**: la variable debe corresponder a alguna de las sondas conectadas a ese `deviceId` (rechaza datos de una variable que ese dispositivo no puede medir).
2. **Rango físico**: el valor debe estar dentro de `[min, max]` del catálogo para esa sonda (rechaza lecturas imposibles — falla de sensor, cable suelto, etc. — antes de escribirlas en Firestore).

Esto es una capa distinta de `configuracion/umbrales`: los umbrales son **reglas de proceso** (¿la turbidez es aceptable en esta etapa del ciclo CIP?) mientras que el rango físico es **una cota de hardware** (¿es siquiera posible que la sonda reporte ese valor?). Un valor puede ser válido físicamente y aun así disparar una alerta de proceso.

### 2.4 Sin cambios en `firestore.rules`
`dispositivos` ya tiene `allow write: if false` — el campo `sondas` solo se gestiona vía Admin SDK (seed o consola), igual que hoy con `apiKeyHash`.

## 3. Diagrama de colecciones (resumen)

```
dispositivos/{deviceId}
  ├─ sondas: [{puerto, modelo}]        ← nuevo
  └─ apiKeyHash, activo, lineaId, ultimoPing

ciclos/{cicloId}
  ├─ etapaActual, ultimaLectura, consumos{}
  └─ lecturas/{lecturaId}
       └─ ts, etapa, deviceId, {variables...}   ← incluye orp, oxigenoDisuelto, cloroResidual, cod

alertas/{alertaId}
  └─ cicloId, variable, valor, min, max, severidad, reconocida

configuracion/umbrales
  └─ {etapa}: {variable: {min,max}}    ← reglas de proceso, no de hardware
```

## 4. Pendiente / siguientes pasos
- Definir umbrales de proceso por etapa para las 4 variables nuevas (orp, oxigenoDisuelto, cloroResidual, cod) junto al cliente (Soprole/Austral Chemicals), igual que se hizo para temperatura/concentración/pH/turbidez.
- Evaluar si el frontend necesita mostrar la unidad/rango de `CATALOGO_SONDAS` en el dashboard para dar contexto al operador.
