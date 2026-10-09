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
- Se agregan además `DR-TS1` y `DS18B20` a `MODELOS_SONDA`/`CATALOGO_SONDAS`, y las variables `ecTemp`/`tempExterna` (ver [sección 5.1](#51-formato-real-del-payload-lorawan)).
- ~~Nuevo `SOPORTADO_LORAWAN_WQSLB`/`BIT_SONDA_LORAWAN`~~ (eliminados): asumían el decoder oficial de Dragino (`decoded_payload` de TTN), que solo sirve para firmware 1.1 o anteriores. Se reemplazaron por un decoder propio (`wqsDecoder.ts`) que interpreta `frm_payload` directo — ver [sección 5.3](#53-adaptador-implementado-functionssrclorawanadapterts).

### 2.2 `dispositivos/{deviceId}`
Se agrega el campo opcional `sondas: Sonda[]` para modelar que **un `deviceId` = una unidad física WQS-LB** con hasta 3 sondas conectadas:

```json
{
  "plantaId": "frutillar",
  "lineaId": "cip-01",
  "tipo": "wqs-lb",
  "activo": true,
  "apiKeyHash": "...",
  "firmware": "1.2",
  "sondas": [
    { "modelo": "DR-PH01" },
    { "modelo": "DR-ECK10.0" },
    { "modelo": "DR-TS1" },
    { "modelo": "DS18B20" }
  ]
}
```

Configuración real del proyecto (`scripts/seed.js`), elegida porque cubre las
variables clave para juzgar un ciclo CIP con el mínimo de sondas:
- **DR-PH01** (pH): el CIP se valida por pH de la solución en cada etapa (ácido/alcalino).
- **DR-ECK10.0** (conductividad): indicador indirecto de concentración/dilución del químico.
- **DR-TS1** (turbidez): señal de arrastre de suciedad, típica para decidir cuándo cortar un enjuague.
- **DS18B20** (temperatura externa): el CIP alcalino/ácido depende de temperatura mínima efectiva.

`firmware: "1.2"` fija el formato de payload que usa el decoder (`wqsDecoder.ts`,
formato B — con temperatura en EC_K10/EC_K1/pH); sin este campo, el decoder
infiere el formato por el largo del payload (ver [sección 5.3](#53-adaptador-implementado-functionssrclorawanadapterts)).

Dispositivos legado (ej. `esp32-01`) sin campo `sondas` mantienen el comportamiento anterior (solo se valida que el valor sea numérico), para no romper compatibilidad.

> ✅ **Corregido** (ver [sección 5.2](#52-corrección-al-modelo-dispositivossondas)): se quitó `puerto` del tipo `Sonda`. El ejemplo de seed usa `DR-ECK10.0` en vez de `DR-EC200`, y `DR-TS1` en vez de `DR-TS200` — ninguna de las dos está soportada por el decoder hasta tener el mapa de bits del flag de 2 bytes (firmware ≥1.3.1).

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

**Historial de firmware** (según `Firmware/changelog.txt` y el manual — ver
`Informacion Tecnica Sensores/WQS-LB/Firmware/WQS-LB-payload-extracto.md`):

| Firmware | Cambios | Formato FPort 2 | Datalog (FPort 3) |
|---|---|---|---|
| 1.0.1 / 1.1 | Versión original | Flag de 1 byte, **sin** temperatura por sonda | Sí |
| 1.2 | Agrega temperatura a pH, DO y EC | Flag de 1 byte, **con** temperatura por sonda | Sí |
| 1.3.1 | Agrega cloro residual, EC de 4 electrodos (EC200), turbidez TS200/TS4000 | Flag de **2 bytes**; mapa de bits no documentado | Sí |
| 1.3.3 | Agrega COD y DO2; **elimina el datalog** | Flag de 2 bytes; mapa de bits no documentado | **No** |

**Byte de flags (FPort=2, firmware < 1.3.1)** — 6 bits inferiores, cada uno indica si esa sonda está presente y con qué divisor decodificar su valor:

| Bit | Sonda | Divisor |
|---|---|---|
| 5 | Turbidez | ÷10 |
| 4 | Oxígeno disuelto | ÷100 |
| 3 | ORP | valor directo |
| 2 | EC_K10 | ×10 |
| 1 | EC_K1 | valor directo |
| 0 | pH | ÷100 |

Desde firmware 1.3.1 el flag pasa a **2 bytes** para poder identificar las
sondas nuevas (CL, EC200, TS200/TS4000, y desde 1.3.3 COD/DO2) — ese mapa de
bits no está documentado en el manual, así que el decoder (`wqsDecoder.ts`)
devuelve error "formato no soportado" en vez de adivinarlo (ver [sección 5.3](#53-adaptador-implementado-functionssrclorawanadapterts)).

**Campos `_temp` (firmware 1.2+)**: EC_K10, EC_K1 y pH van seguidos de su
propia temperatura (2 bytes, ÷10) cuando están presentes. El manual no aclara
si oxígeno disuelto también agrega temperatura en 1.2 (el changelog dice que
sí, la tabla de payload no la incluye); el decoder resuelve la ambigüedad
probando ambas hipótesis contra el largo real del payload.

**Intervalo de envío por defecto: 20 minutos** (configurable vía comando AT `AT+TDC`, pero pensado para bajo consumo — no para streaming en tiempo real como simulamos con `simulador.js` cada 2-3s).

### 5.2 Corrección al modelo `dispositivos.sondas` ✅

El diseño original (`sondas: [{puerto, modelo}]`) asumía puertos libres con cualquier modelo de sonda. El hardware real es más rígido: son sondas fijas identificadas por bit en el flag de FPort=2/3, y el firmware determina cuáles se pueden decodificar:

- **Soportadas en formatos A/B** (firmware < 1.3.1, flag de 1 byte, mapa de bits documentado): `DR-PH01`, `DR-ECK1.0`, `DR-ECK10.0`, `DR-ORP1`, `DR-DO1`, `DR-TS1` (esta última por inferencia del changelog, no está en la tabla del manual).
- **Sin soporte hasta tener el mapa de bits del flag de 2 bytes** (firmware ≥1.3.1): `DR-CL-2ML`, `DR-CL-10ML`, `DR-EC200`, `DR-TS200`, `DR-TS4000` (agregadas en 1.3.1) y `DR-COD`, `DR-DO2` (agregadas en 1.3.3).

**Implementado en `types.ts`**: se quitó `puerto` del tipo `Sonda` (ahora `{ modelo: ModeloSonda }`). Ya no existen `SOPORTADO_LORAWAN_WQSLB` ni `BIT_SONDA_LORAWAN` (asumían el decoder oficial de Dragino vía `decoded_payload`, solo válido para firmware 1.1 o anteriores) — el decoder propio (`wqsDecoder.ts`) reemplaza esa lógica decodificando `frm_payload` directo. El seed de ejemplo usa `DR-PH01` + `DR-ECK10.0` + `DR-TS1` + `DS18B20`, con `firmware: "1.2"`.

**Pendiente real**: `DR-CL-*`, `DR-COD`, `DR-EC200`, `DR-TS200`/`DR-TS4000` y `DR-DO2` **sí son compatibles a nivel de hardware** (el changelog confirma que el firmware las soporta) — lo pendiente no es si son compatibles, sino el mapa de bits del flag de 2 bytes y el tamaño de cada valor nuevo. Pedir esa información a Dragino, o deducirla conectando una sonda a la vez y comparando payloads.

### 5.3 Adaptador implementado: `functions/src/lorawanAdapter.ts` ✅

Se implementó `ttnUplink`, una Cloud Function HTTP separada de `ingestLectura`, expuesta en `/api/ttn-uplink` (`firebase.json`). Flujo real:

```
Sensor WQS-LB (RS485: pH/EC/turbidez + DS18B20 externo)
   │  LoRaWAN uplink (binario, FPort 2/3/5)
   ▼
Gateway LoRaWAN → Network Server (The Things Stack / TTN)
   │  uplink_message.frm_payload (bytes crudos, base64) + f_port + received_at
   ▼
Webhook TTN → POST /api/ttn-uplink   (header x-webhook-secret)
   ▼
ttnUplink:
  1. Valida x-webhook-secret contra process.env.TTN_WEBHOOK_SECRET
  2. Decodifica frm_payload con wqsDecoder.ts (decoder propio, ver más abajo).
     Ignora (200, sin escribir) si fport≠2, dispositivo desconocido, sin
     frm_payload/dev_eui, sin received_at parseable, o si el decoder devuelve
     error — así TTN no reintenta en loop por errores de negocio
  3. Mapea end_device_ids.device_id → dispositivos/{deviceId} (mismo id, ver
     convención de aprovisionamiento en el código); lee dispositivos/{deviceId}.firmware
     para elegir el formato de payload (si no existe, el decoder infiere A/B por largo)
  4. Traduce los campos del decoder a las Variable internas con un mapeo fijo
     para la configuración de sondas de este proyecto (ph, conductividad,
     turbidez, ecTemp, tempExterna — ver más abajo)
  5. Resuelve cicloId/etapa (ver 5.4) y llama a procesarLectura()
     — la misma función que usa ingestLectura, extraída de ingest.ts
  6. ts de la lectura = uplink_message.received_at (no la hora del servidor);
     lecturaId determinista {devEui}_{tsSegundos} para que un reintento de
     TTN no duplique la lectura (mismo ID → el segundo write pisa al primero)
```

**Decoder propio (`functions/src/wqsDecoder.ts`)**: reemplaza `uplink_message.decoded_payload`
del decoder oficial de Dragino (GitHub), que corresponde al firmware 1.1 o
anteriores y no soporta las temperaturas por sonda que agregó el firmware 1.2
(ver [sección 5.1](#51-formato-real-del-payload-lorawan)). El decoder es una
función pura (`decodeWqs(bytes, fPort, firmware?)`) que interpreta FPort 2/3/5
directo desde los bytes, valida el largo del payload contra los bits activos
antes de interpretarlo, y devuelve error "formato no soportado" en vez de
adivinar el mapa de bits no documentado (firmware ≥1.3.1). Probado con 21
tests (Vitest, `functions/src/wqsDecoder.test.ts` e `ingest.test.ts`) contra
los ejemplos del manual y los casos de regresión (ver [sección 7](#7-limitaciones-y-trabajo-futuro)).

**Mapeo `phTemp` → `temperatura`**: el decoder produce un campo `phTemp`
(temperatura propia de la sonda DR-PH01), pero el adaptador lo guarda en la
lectura como la variable genérica `temperatura` — no como una variable nueva.
Es así porque `configuracion/umbrales` y el dashboard ya usan `temperatura`
para la temperatura del proceso CIP en cada etapa (75–80°C en alcalino,
55–65°C en ácido, etc.); crear una variable `phTemp` separada habría dejado
esa lectura sin umbral y fuera del dashboard. `ecTemp` (de EC_K10) y
`tempExterna` (del DS18B20 externo) sí son variables propias, nuevas.

⚠️ **Sigue sin verificarse contra un payload real de TTN** (no hay cuenta ni gateway). Se probó localmente contra los emuladores con `scripts/simulador-ttn.js` (`npm run sim:ttn`, ver `README.md`): lectura válida, pH fuera de rango físico, dispositivo desconocido, FPort≠2, y reenvío del mismo payload con el mismo `received_at` (idempotencia de lectura y alertas) — todos se comportan como se diseñó, incluida la prueba manual con emuladores. Falta confirmar que `frm_payload` y `f_port` lleguen con el formato asumido en un uplink real.

### 5.4 Resolución de `cicloId`/`etapa` ✅

Se implementó la segunda alternativa propuesta: `ttnUplink` consulta `ciclos` por `lineaId == dispositivos[deviceId].lineaId` y `estado == "en_curso"` (sin índice compuesto adicional — dos filtros de igualdad no lo requieren en Firestore), y usa el `etapaActual` de ese ciclo. Si no hay ciclo en curso en la línea, el uplink se ignora (200, sin escribir) — no tiene sentido registrar calidad de agua fuera de un ciclo CIP activo. No se agregó el puntero `cicloActivoId` en `dispositivos` para evitar una segunda fuente de verdad.

**Validado con emuladores**: al cambiar `ciclos/CIP-2026-0001.estado` a `"finalizado"`, el adaptador ignoró correctamente el uplink; al restaurarlo a `"en_curso"`, volvió a procesar y usó el `etapaActual` vigente en ese momento (no un valor fijo).

**FPort 3 (datalog) queda fuera del alcance actual**: `ttnUplink` solo procesa FPort=2. Asignarle a un registro de datalog atrasado "el ciclo en curso ahora" sería incorrecto — el registro corresponde a un momento pasado, que puede ser de otro ciclo o de ningún ciclo. Resolverlo bien requiere asignar el ciclo por ventana de tiempo (ver [sección 7](#7-limitaciones-y-trabajo-futuro)), no por el ciclo activo al momento de recibir el uplink. Además, el firmware 1.3.3 elimina por completo la función de datalog, así que el alcance de esta decisión depende de qué firmware se fije en los equipos reales.

### 5.5 Brechas conocidas para el siguiente sprint
- No hay cuenta de The Things Stack ni gateway LoRaWAN configurado — nada de esto se pudo probar con hardware real ni con un payload TTN genuino.
- `TTN_WEBHOOK_SECRET` se lee como variable de entorno simple (`process.env`); antes de producción migrar a Secret Manager (`defineSecret` de `firebase-functions/params`).
- Falta configurar el webhook real en la consola de TTN una vez se tenga la cuenta y el dispositivo físico.
- Ver [sección 7](#7-limitaciones-y-trabajo-futuro) para las limitaciones del decoder propio (firmware ≥1.3.1, intervalo de envío, datalog, etc.).

## 6. Pendiente / siguientes pasos
- Definir umbrales de proceso por etapa para las 4 variables nuevas (orp, oxigenoDisuelto, cloroResidual, cod) junto al cliente (Soprole/Austral Chemicals), igual que se hizo para temperatura/concentración/pH/turbidez.
- Evaluar si el frontend necesita mostrar la unidad/rango de `CATALOGO_SONDAS` en el dashboard para dar contexto al operador.
- Conseguir cuenta de The Things Stack + gateway LoRaWAN para validar `ttnUplink` contra un payload real (ver 5.5).
- Revisar con el cliente las condiciones de operación de las sondas frente a las etapas calientes/químicas del CIP: el datasheet limita la mayoría a 0–60°C (0–40°C para turbidez y COD) y el cloro libre a pH 4–9, mientras que el CIP alcanza 75–80°C en alcalino y usa soda cáustica/ácido — confirmar si las sondas actuales (DR-PH01, DR-ECK10.0, DR-TS1) soportan esas condiciones en la línea real o si el monitoreo debe limitarse a etapas de enjuague (ver [sección 7](#7-limitaciones-y-trabajo-futuro)).

## 7. Limitaciones y trabajo futuro

**Decoder y firmware:**
- `DR-ECK1.0` (no usado en la configuración actual) sigue con la variable genérica `temperatura` en `CATALOGO_SONDAS`, mientras que `DR-ECK10.0` ya usa `ecTemp` — quedaría inconsistente si en algún momento se conecta esa sonda en vez de la K10. No se corrigió porque no está en el seed actual del proyecto.
- El flag de 2 bytes de firmware ≥1.3.1 no tiene mapa de bits documentado — bloquea `DR-CL-2ML`, `DR-CL-10ML`, `DR-EC200`, `DR-TS200`, `DR-TS4000` (1.3.1) y `DR-COD`, `DR-DO2` (1.3.3), aunque el hardware sí las soporta (ver [sección 5.2](#52-corrección-al-modelo-dispositivossondas)).
- La inferencia de formato cuando el dispositivo no tiene `firmware` registrado distingue entre A y B probando cuál calza con el largo del payload, pero **no detecta el formato C**: un equipo con firmware 1.3.x sin `firmware` guardado en `dispositivos/{deviceId}` podría decodificarse igual como A o B, con valores falsos, en vez de fallar con "formato no soportado". Es un mecanismo de compatibilidad para no bloquear la ingesta mientras se aprovisiona el dispositivo, no un sustituto de fijar el firmware real en Firestore.
- Nunca se verificó contra un uplink real de TTN — no hay cuenta ni gateway (ver 5.3/5.5).

**Datalog (FPort 3):**
- Sin implementar (ver [sección 5.4](#54-resolución-de-cicloidetapa)): falta decidir cómo asignar el ciclo a un registro atrasado por ventana de tiempo, en vez de usar el ciclo activo al momento de recibir el uplink.
- El firmware 1.3.3 elimina por completo la función de datalog: en esa versión, las lecturas que se pierden durante una caída de red (sin ACK) ya no se guardan para reenviar después — la pérdida es definitiva, a diferencia de 1.0.1–1.3.1.

**Proceso CIP y hardware:**
- El intervalo de envío por defecto (20 minutos) es mucho más largo que la duración de algunas etapas del CIP (minutos): una etapa corta puede terminar sin haber recibido ninguna lectura del WQS-LB. Evaluar si hace falta reconfigurar `AT+TDC` en el equipo real.
- `DR-ECK10.0` se satura en 20.000 µS/cm; las soluciones de soda cáustica típicas de un CIP alcalino superan ese valor con facilidad. La sonda sirve para detectar cuándo el enjuague volvió a agua limpia (la conductividad cae), **no** para medir la concentración real del químico durante las etapas alcalina/ácida.
- **Umbral de alerta vs. criterio de limpieza (son dos cosas distintas):**
  - El **umbral de alerta** (`configuracion/umbrales`, por etapa) marca el límite de lo **aceptable**: si una lectura lo cruza se genera una alerta. En `enjuague_final`: `conductividad25C ≤ 300 µS/cm`, `turbidez ≤ 20 NTU`, `pH 6–8,5`.
  - El **criterio de limpieza** (`configuracion/calculos.criterioLimpio`) marca cuándo el agua está **limpia** y define `tiempoHastaLimpio`. Es más exigente: `conductividad25C ≤ 200 µS/cm` y `turbidez ≤ 10 NTU`. Entre 200 y 300 µS/cm, o entre 10 y 20 NTU, el agua es aceptable (sin alerta) pero todavía no limpia.
  - Antes eran los mismos números (300 µS/cm y 20 NTU): el primer valor que dejaba de alertar ya contaba como limpio, y `tiempoHastaLimpio` no medía nada útil.
  - El `tiempoHastaLimpio` **global** del ciclo se calcula solo con las lecturas del enjuague final (`calcularIndicadoresCiclo`, `functions/src/ciclos.ts`), desde su primera lectura. Si el enjuague final no tiene lecturas o nunca cumple el criterio, queda sin valor, aunque un enjuague intermedio sí lo haya cumplido. El desglose por etapa conserva el valor de cada etapa.
- **Umbrales fijos por etapa y arrastre químico:** los umbrales de proceso (`configuracion/umbrales`) valen para toda la etapa, desde el primer segundo. En un ciclo real, el comienzo de cada enjuague todavía trae solución de la etapa química anterior (soda o ácido): la conductividad y el pH de las primeras lecturas superan los umbrales y se dispararía una alerta en **cada** enjuague, aunque el ciclo salga bien. El simulador de la demo (`scripts/simulador-cip.js`, escenario `normal`) lo evita desfasando los uplinks 5 s del inicio de cada etapa, con el arrastre ya evacuado; eso es un ajuste de la demo, no una solución. **Mejora futura (sin implementar):** un período de gracia por etapa (p. ej. `graciaS` en los umbrales) durante el cual las lecturas se guardan pero no generan alertas.
- **Supuesto sobre la compensación de temperatura de la conductividad (sin verificar):** `derivarLectura` (`functions/src/calculos.ts`) calcula `conductividad25C = EC / (1 + α·(T − 25))`, con `T = tempEc` y `α = factorCompensacionEC` (0,02 por defecto). Es decir, **asume que la EC que entrega el payload viene cruda**, sin compensar. Pero según el manual de Dragino (sección 4.2.2), la `DR-ECK10.0` ya compensa la temperatura internamente (coeficiente 0,02, referencia 25 °C). Si eso aplica al valor que reporta el WQS-LB, la app compensa dos veces: cerca de 25 °C el error es mínimo, pero en un enjuague a 50 °C rondaría el 50 %. El error se propaga a `criterioLimpio`, a los umbrales y alertas sobre `conductividad25C` y a `tiempoHastaLimpio`.
  - **Cómo verificarlo:** preguntar a Dragino si el registro Modbus que reporta el WQS-LB es conductividad compensada o cruda, o medir con el sensor real la solución patrón de 12,88 mS/cm a una temperatura distinta de 25 °C y ver cuál de los dos valores (EC o `conductividad25C`) coincide.
  - **Si se confirma que la sonda ya compensa:** basta con poner `factorCompensacionEC: 0` en el documento `configuracion/calculos` de Firestore, sin tocar código. Con α = 0 la fórmula devuelve la EC sin cambios. El cambio solo afecta a las lecturas nuevas: `conductividad25C` se calcula en la ingesta y se guarda en cada lectura, y `scripts/recalcular.js` recalcula los indicadores del ciclo a partir de ese valor guardado, no lo vuelve a derivar.
- Límites de operación de las sondas (ver [sección 6](#6-pendiente--siguientes-pasos)): el alcance que propone esta arquitectura es monitorear la calidad del agua de enjuague, no las etapas químicas a alta temperatura — falta confirmar con el cliente si eso es suficiente o si esas etapas necesitan otra instrumentación.
- El rango del DS18B20 externo (-55–125°C, `CATALOGO_SONDAS["DS18B20"]`) es el del datasheet genérico del chip, no una especificación propia de cómo Dragino lo integra/cablea en el WQS-LB.

**Datos fuera de ciclo:**
- Las lecturas que llegan sin un ciclo `en_curso` en la línea se descartan (ver [sección 5.4](#54-resolución-de-cicloidetapa)): si una sonda falla entre dos ciclos (se desconecta, se satura, queda fuera de rango), eso solo se detecta cuando arranca el ciclo siguiente y llega la primera lectura — no hay alerta de "sonda sin reportar" mientras no hay un ciclo activo.
