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
- Nuevo tipo `Sonda = { modelo: ModeloSonda }` — **sin `puerto`** (corregido, ver 5.2): el protocolo LoRaWAN real identifica sondas por tipo fijo, no por puerto libre.
- Nuevo `SOPORTADO_LORAWAN_WQSLB`: subconjunto de `MODELOS_SONDA` que el decoder oficial del WQS-LB realmente reporta (excluye `DR-EC200`, `DR-CL-2ML`, `DR-CL-10ML`, `DR-COD`).
- Nuevo `BIT_SONDA_LORAWAN`: mapea cada bit del byte de flags (FPort=2) al nombre de campo que entrega el decoder de TTN (`PH`, `EC_K1`, `EC_K10`, `ORP`, `dissolved_oxygen`, `turbidity`) y a la `Variable` interna correspondiente.

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
    { "modelo": "DR-PH01" },
    { "modelo": "DR-ECK10.0" },
    { "modelo": "DR-TS200" }
  ]
}
```

Dispositivos legado (ej. `esp32-01`) sin campo `sondas` mantienen el comportamiento anterior (solo se valida que el valor sea numérico), para no romper compatibilidad.

> ✅ **Corregido** (ver [sección 5.2](#52-corrección-al-modelo-dispositivossondas)): se quitó `puerto` del tipo `Sonda`. El ejemplo de seed usa `DR-ECK10.0` en vez de `DR-EC200`, que no está soportado por el decoder LoRaWAN real.

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
  ├─ sondas: [{modelo}]                ← nuevo
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

### 5.2 Corrección al modelo `dispositivos.sondas` ✅

El diseño original (`sondas: [{puerto, modelo}]`) asumía puertos libres con cualquier modelo de sonda. El hardware real es más rígido: son **6 tipos de sonda fijos identificados por bit**, y el decoder revisado solo cubre pH, EC_K1, EC_K10, ORP, O₂ disuelto y turbidez — **no incluye cloro residual (`DR-CL`) ni COD (`DR-COD`)**, que probablemente requieran otra variante de firmware/decoder aún no revisada.

**Implementado en `types.ts`**: se quitó `puerto` del tipo `Sonda` (ahora `{ modelo: ModeloSonda }`), se agregó `SOPORTADO_LORAWAN_WQSLB` (los 8 modelos que sí decodifica el WQS-LB) y `BIT_SONDA_LORAWAN` (bit → nombre de campo del decoder → `Variable`). El seed de ejemplo se actualizó a `DR-PH01` + `DR-ECK10.0` + `DR-TS200` (todas soportadas), reemplazando `DR-EC200`.

**Pendiente real**: confirmar con Dragino si existe un decoder que cubra CL/COD, o si esas sondas simplemente no son compatibles con la unidad WQS-LB.

### 5.3 Adaptador implementado: `functions/src/lorawanAdapter.ts` ✅

Se implementó `ttnUplink`, una Cloud Function HTTP separada de `ingestLectura`, expuesta en `/api/ttn-uplink` (`firebase.json`). Flujo real:

```
Sensor WQS-LB (RS485: pH/EC/ORP/DO/turbidez)
   │  LoRaWAN uplink (binario, FPort 2/3/5)
   ▼
Gateway LoRaWAN → Network Server (The Things Stack / TTN)
   │  decoder oficial Dragino (JavaScript) → uplink_message.decoded_payload
   ▼
Webhook TTN → POST /api/ttn-uplink   (header x-webhook-secret)
   ▼
ttnUplink (nuevo):
  1. Valida x-webhook-secret contra process.env.TTN_WEBHOOK_SECRET
  2. Ignora (200, sin escribir) si fport≠2, dispositivo desconocido, o sin
     payload decodificado — así TTN no reintenta en loop por errores de negocio
  3. Mapea end_device_ids.device_id → dispositivos/{deviceId} (mismo id, ver
     convención de aprovisionamiento en el código)
  4. Traduce decoded_payload (PH, EC_K1, EC_K10, ORP, dissolved_oxygen,
     turbidity, temp_DS18B20) a las Variable internas vía BIT_SONDA_LORAWAN
  5. Resuelve cicloId/etapa (ver 5.4) y llama a procesarLectura()
     — la misma función que usa ingestLectura, extraída de ingest.ts
```

`ingest.ts` se refactorizó: la validación y escritura (rango físico, ciclo, umbrales, batch) quedó en `procesarLectura()`, exportada y reutilizada por ambos endpoints — así el adaptador no duplica reglas de negocio.

⚠️ **Sigue sin verificarse contra un payload real de TTN** (no hay cuenta ni gateway). Se probó localmente simulando el body exacto que TTN debería enviar (`scripts/simulador-ttn.js`, `npm run sim:ttn`), contra los emuladores: lectura válida, pH fuera de rango, dispositivo desconocido, FPort≠2, secreto inválido, y sin ciclo en curso — los 6 casos se comportan como se diseñó. Falta confirmar que los nombres de campo (`PH`, `EC_K10`, etc.) sean exactamente los que TTN entrega en producción.

### 5.4 Resolución de `cicloId`/`etapa` ✅

Se implementó la segunda alternativa propuesta: `ttnUplink` consulta `ciclos` por `lineaId == dispositivos[deviceId].lineaId` y `estado == "en_curso"` (sin índice compuesto adicional — dos filtros de igualdad no lo requieren en Firestore), y usa el `etapaActual` de ese ciclo. Si no hay ciclo en curso en la línea, el uplink se ignora (200, sin escribir) — no tiene sentido registrar calidad de agua fuera de un ciclo CIP activo. No se agregó el puntero `cicloActivoId` en `dispositivos` para evitar una segunda fuente de verdad.

**Validado con emuladores**: al cambiar `ciclos/CIP-2026-0001.estado` a `"finalizado"`, el adaptador ignoró correctamente el uplink; al restaurarlo a `"en_curso"`, volvió a procesar y usó el `etapaActual` vigente en ese momento (no un valor fijo).

### 5.5 Brechas conocidas para el siguiente sprint
- No hay cuenta de The Things Stack ni gateway LoRaWAN configurado — nada de esto se pudo probar con hardware real ni con un payload TTN genuino.
- El decoder oficial revisado no cubre `cloroResidual` ni `cod`.
- El intervalo por defecto (20 min) es mucho más lento que los umbrales de proceso pensados para un ciclo CIP (minutos) — evaluar si hay que reconfigurar `AT+TDC` en el dispositivo real.
- `TTN_WEBHOOK_SECRET` se lee como variable de entorno simple (`process.env`); antes de producción migrar a Secret Manager (`defineSecret` de `firebase-functions/params`).
- Falta configurar el webhook real en la consola de TTN una vez se tenga la cuenta y el dispositivo físico.

## 6. Pendiente / siguientes pasos
- Definir umbrales de proceso por etapa para las 4 variables nuevas (orp, oxigenoDisuelto, cloroResidual, cod) junto al cliente (Soprole/Austral Chemicals), igual que se hizo para temperatura/concentración/pH/turbidez.
- Evaluar si el frontend necesita mostrar la unidad/rango de `CATALOGO_SONDAS` en el dashboard para dar contexto al operador.
- Conseguir cuenta de The Things Stack + gateway LoRaWAN para validar `ttnUplink` contra un payload real (ver 5.5).
