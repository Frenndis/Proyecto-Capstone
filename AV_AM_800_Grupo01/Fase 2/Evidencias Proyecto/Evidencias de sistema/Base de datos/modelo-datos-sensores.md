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

> ⚠️ **Corrección pendiente**: al revisar el protocolo LoRaWAN real del WQS-LB (ver [sección 5](#5-arquitectura-de-integración-lorawan--backend)), el dispositivo identifica sus sondas por un **byte de flags de 6 bits** (pH, EC_K1, EC_K10, ORP, O₂ disuelto, turbidez), no por un `puerto` 1/2/3 libre como se modeló aquí. Este campo `sondas` hay que ajustarlo antes de implementar el adaptador real — ver sección 5.2.

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

## 5. Arquitectura de integración LoRaWAN → Backend

Lo diseñado en las secciones 1-3 asume que `POST /api/ingest` recibe un JSON `{deviceId, cicloId, etapa, valores}`. **El sensor real nunca envía ese formato.** Esta sección documenta la brecha real entre el hardware y `ingestLectura`, basada en la documentación oficial de Dragino (wiki + [decoder oficial](https://github.com/dragino/dragino-end-node-decoder/blob/main/WQS-LB/WQS-LB_TTN_Decoder.txt)).

### 5.1 Formato real del payload LoRaWAN

El WQS-LB sube datos binarios (no JSON) en distintos **FPort**:

| FPort | Contenido | Notas |
|---|---|---|
| 2 | Lectura en tiempo real | Batería, temperatura DS18B20, byte de flags + valores de sondas activas |
| 3 | Datalog | Lecturas guardadas cuando no hubo ACK de red (hasta 3 mediciones/trama, con timestamp Unix) |
| 5 | Estado del dispositivo | Modelo, versión firmware, banda de frecuencia, batería — se envía cada 12h |

**Byte de flags (FPort=2)** — 6 bits inferiores, cada uno indica si esa sonda está presente y con qué divisor decodificar su valor:

| Bit | Sonda | Divisor |
|---|---|---|
| 5 | Turbidez | ÷10 |
| 4 | Oxígeno disuelto | ÷100 |
| 3 | ORP | valor directo |
| 2 | EC_K10 | ×10 |
| 1 | EC_K1 | valor directo |
| 0 | pH | ÷100 |

**Intervalo de envío por defecto: 20 minutos** (configurable vía comando AT `AT+TDC`, pero pensado para bajo consumo — no para streaming en tiempo real como simulamos con `simulador.js` cada 2-3s).

### 5.2 Corrección al modelo `dispositivos.sondas`

El diseño de la sección 2.2 (`sondas: [{puerto, modelo}]`) asume puertos libres con cualquier modelo de sonda. El hardware real es más rígido: son **6 tipos de sonda fijos identificados por bit**, y el decoder revisado solo cubre pH, EC_K1, EC_K10, ORP, O₂ disuelto y turbidez — **no incluye cloro residual (`DR-CL`) ni COD (`DR-COD`)**, que probablemente requieran otra variante de firmware/decoder aún no revisada. Antes de implementar el adaptador (5.3) hay que:
- Confirmar si existe un decoder de Dragino que sí cubra CL/COD, o si esas sondas no son compatibles con la unidad WQS-LB actual.
- Simplificar `Sonda` a algo como `{ bit: 0-5, variable: Variable }` que refleje el flag real, en vez de un `puerto` arbitrario.

### 5.3 Flujo de integración propuesto

```
Sensor WQS-LB (RS485: pH/EC/ORP/DO/turbidez)
   │  LoRaWAN uplink (binario, FPort 2/3/5)
   ▼
Gateway LoRaWAN
   ▼
Network Server (The Things Stack / TTN)
   │  decoder oficial Dragino (JavaScript) → JSON decodificado
   ▼
Webhook / integración TTN → MQTT o HTTP
   ▼
┌───────────────────────────────────────────┐
│ NUEVO: Cloud Function "adaptador"          │  ← no existe todavía
│  1. Recibe el payload de TTN               │
│  2. Mapea el Device EUI → deviceId propio  │
│  3. Traduce el JSON decodificado a         │
│     {ph, orp, turbidez, ...} (Variable)    │
│  4. Resuelve cicloId/etapa activos para    │
│     la línea de ese dispositivo            │  ← problema abierto, ver 5.4
│  5. Llama a la misma lógica de             │
│     ingestLectura (o hace el POST interno) │
└───────────────────────────────────────────┘
   ▼
POST /api/ingest  (formato ya validado en esta sesión)
```

### 5.4 Problema abierto: el sensor no conoce el "ciclo CIP"

El payload del WQS-LB **nunca incluye `cicloId` ni `etapa`** — el dispositivo solo sabe medir agua, no participa del proceso de negocio. El adaptador del punto 5.3 necesita resolver "¿cuál es el ciclo activo y la etapa actual de la línea a la que pertenece este `deviceId`?" antes de poder llamar a `ingestLectura`. Posibles enfoques a evaluar en el próximo sprint:
- Mantener en `dispositivos/{deviceId}` un puntero `cicloActivoId` que el operador actualiza al iniciar/cambiar de etapa un ciclo, y que el adaptador lee en cada uplink.
- Que el propio ingest infiera el ciclo "en curso" de la línea del dispositivo (consultando `ciclos` por `lineaId` + `estado: "en_curso"`), evitando mantener el puntero duplicado.

### 5.5 Brechas conocidas para el siguiente sprint
- No hay cuenta de The Things Stack ni gateway LoRaWAN configurado — nada de esto se pudo probar con hardware real.
- El decoder oficial revisado no cubre `cloroResidual` ni `cod`.
- El intervalo por defecto (20 min) es mucho más lento que los umbrales de proceso pensados para un ciclo CIP (minutos) — evaluar si hay que reconfigurar `AT+TDC` en el dispositivo real.
- Falta decidir dónde vive el adaptador (¿nueva Cloud Function HTTP, o Pub/Sub trigger si TTN integra vía Google Cloud IoT/Pub-Sub?).

## 6. Pendiente / siguientes pasos
- Definir umbrales de proceso por etapa para las 4 variables nuevas (orp, oxigenoDisuelto, cloroResidual, cod) junto al cliente (Soprole/Austral Chemicals), igual que se hizo para temperatura/concentración/pH/turbidez.
- Evaluar si el frontend necesita mostrar la unidad/rango de `CATALOGO_SONDAS` en el dashboard para dar contexto al operador.
- Implementar el adaptador LoRaWAN→ingest descrito en la sección 5, una vez se resuelvan los puntos 5.2 y 5.4.
