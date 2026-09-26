# Tareas: decoder propio WQS-LB y ajustes al adaptador LoRaWAN (StormCIP)

> Todas las rutas de este documento son relativas a la carpeta `Evidencias de sistema/`, que es donde se abre Claude Code. Las rutas tienen espacios y tildes (`Aplicación`), así que en la terminal van entre comillas.

## Archivos de referencia

| Qué | Ruta |
|---|---|
| Manual oficial (fuente de verdad del formato de bytes) | `Informacion Tecnica Sensores/WQS-LB/WQS-LB-LS.pdf` |
| Changelog del firmware | `Informacion Tecnica Sensores/WQS-LB/Firmware/changelog.txt` |
| Modelo de datos | `Base de datos/modelo-datos-sensores.md` |
| Adaptador TTN | `Aplicación/stormcip/functions/src/lorawanAdapter.ts` |
| Lógica de ingesta | `Aplicación/stormcip/functions/src/ingest.ts` |
| Tipos y catálogo | `Aplicación/stormcip/functions/src/types.ts` |
| Simulador TTN | `Aplicación/stormcip/scripts/simulador-ttn.js` |
| Seed | `Aplicación/stormcip/scripts/seed.js` |

## Contexto

El adaptador `lorawanAdapter.ts` (`ttnUplink`) hoy confía en `uplink_message.decoded_payload`, generado por el decoder oficial de Dragino en GitHub. Ese decoder corresponde al formato de los firmware antiguos (1.1 o anteriores) y **no sirve para las versiones actuales**.

### Historial del firmware (según `changelog.txt` y el PDF)

| Firmware | Cambios | Formato FPort 2 | Datalog (FPort 3) |
|---|---|---|---|
| 1.0.1 / 1.1 | Versión original | Flag de 1 byte, **sin** temperaturas por sonda (lo que asume el decoder de GitHub) | Sí |
| 1.2 | Agrega temperatura a pH, DO y EC | Flag de 1 byte, **con** temperaturas por sonda | Sí |
| 1.3.1 | Agrega cloro residual, EC de cuatro electrodos (EC200), turbidez TS200/TS4000 | Flag de **2 bytes**; mapa de bits no documentado | Sí |
| 1.3.3 | Agrega COD y DO2; **elimina el datalog** | Flag de 2 bytes; mapa de bits no documentado | **No** |

Consecuencias:

- Con firmware 1.2, el decoder de GitHub lee mal cualquier combinación donde una sonda con temperatura no sea la última. **El seed actual (DR-PH01 + DR-ECK10.0 + DR-TS200) lee `ECK10_temp` como pH**, y el valor falso pasa la validación de rango.
- Según el changelog, TS200/TS4000 recién se soportan desde 1.3.1. En firmware 1.2, el bit de turbidez correspondería a la DR-TS1 (inferencia: confirmar con Dragino).
- **Discrepancia a resolver:** el changelog dice que la 1.2 agregó temperatura también al oxígeno disuelto, pero la tabla del PDF no incluye `DO_temp`. El decoder debe resolverlo validando el largo del payload (ver Tarea 1).
- `temp_DS18B20` del decoder de GitHub sale como string (`toFixed`), no como número.

**Fuente de verdad para todo el formato de bytes: el PDF y el changelog.** No usar el decoder de GitHub como referencia.

## Reglas para esta tarea

1. Lee el PDF (secciones 2.2 y 2.3), el `changelog.txt` y `modelo-datos-sensores.md` antes de escribir código.
2. Propón un plan y espera aprobación antes de implementar.
3. Implementa una tarea a la vez, con sus tests, y detente al terminar cada una para revisión.
4. **No inventes formatos no documentados.** Si un payload no calza con lo documentado, el decoder debe devolver un error explícito de "formato no soportado" y conservar el payload crudo. No adivines el mapa de bits del flag de 2 bytes.
5. No modificar `firestore.rules`.

---

## Tarea 1 — Decoder propio (`Aplicación/stormcip/functions/src/wqsDecoder.ts`)

Función pura, sin dependencias de Firestore, que recibe `(bytes: Uint8Array, fPort: number, firmware?: string)` y devuelve un resultado tipado o un error. El formato se elige según la versión de firmware.

**FPort 5 (estado del dispositivo):** modelo (1 byte), firmware (2 bytes: `0x0100` = 1.0.0, `0x0133` = 1.3.3), banda (1 byte), sub-banda (1 byte), batería (2 bytes, /1000 V).

**FPort 2 (tiempo real), campos comunes:**
- Batería: 2 bytes, `(valor & 0x3FFF) / 1000` V.
- Temperatura DS18B20: 2 bytes con signo, /10. Si el valor crudo es `0x0CCC`, devolver `null` (sensor no conectado).

**Formato A (firmware < 1.2):** flag de 1 byte (bit 7 = interrupción; bits 5..0 = turbidez, oxígeno disuelto, ORP, EC_K10, EC_K1, pH). Después, 2 bytes por sonda presente, en ese orden, **sin** temperaturas:
- turbidez: /10 · oxígeno disuelto: /100 · ORP: con signo, mV · EC_K10: ×10 µS/cm · EC_K1: µS/cm · pH: /100

**Formato B (firmware 1.2.x):** igual que el formato A, pero EC_K10, EC_K1 y pH van **seguidos de su temperatura** (2 bytes, /10). Para el oxígeno disuelto hay dos hipótesis (con o sin `doTemp`); usar la que haga calzar exactamente el largo del payload.

**Formato C (firmware ≥ 1.3.1):** devolver error "formato no soportado" hasta tener el mapa de bits del flag de 2 bytes.

**Validación de largo (obligatoria en todos los formatos):** calcular el largo esperado a partir de los bits activos y compararlo con el largo real. Si no coincide, devolver error "formato no soportado" en vez de interpretar los bytes. Es la protección principal contra leer columnas corridas.

**FPort 3 (datalog, solo firmware < 1.3.3):** registros de 11 bytes: 6 bytes de valores (hasta 3 sondas, en el mismo orden de bits, sin temperaturas), 1 byte de flags (bit 7 = sin ACK, bits 5..0 = sondas presentes) y 4 bytes de timestamp Unix. Ignorar los registros de 11 bytes en cero.

### Tests obligatorios

Si `functions/` no tiene un framework de tests configurado, propón uno (por ejemplo Jest o Vitest) en el plan antes de instalarlo.

Ejemplos oficiales del PDF:

| Caso | FPort | Firmware | Payload (hex) | Resultado esperado |
|---|---|---|---|---|
| Estado | 5 | — | `3C010001000DC8` | modelo 0x3C, firmware 1.0.0, banda EU868, sub-banda 0, batería 3.528 V |
| Tiempo real | 2 | 1.2 | `0CB40CCC2909CE000202DE0111` | batería 3.252 V, tempExterna `null`, turbidez 251.0, ORP 2, pH 7.34, phTemp 27.3 |
| Datalog | 3 | 1.2 | `048B013E03889367D39699` | oxígeno disuelto 11.63, EC_K1 318, pH 9.04, sinAck `true`, timestamp 1741919897 |
| Datalog vacío | 3 | 1.2 | 11 bytes en `00` | ningún registro |

Casos construidos a partir del PDF y el changelog (no son ejemplos oficiales; confirmarlos con un uplink real):

| Caso | FPort | Firmware | Payload (hex) | Resultado esperado |
|---|---|---|---|---|
| **pH + EC_K10 + turbidez** (regresión del bug) | 2 | 1.2 | `0CB40CCC2509CE03E8011102BC0111` | turbidez 251.0, EC_K10 10000, ecTemp 27.3, **pH 7.00 (no 2.73)**, phTemp 27.3 |
| Formato antiguo | 2 | 1.1 | `0CB40CCC2909CE000202DE` | turbidez 251.0, ORP 2, pH 7.34, sin temperaturas |
| Largo incorrecto | 2 | 1.1 | `0CB40CCC2909CE000202DE0111` | error "formato no soportado" (sobran 2 bytes) |
| DO con temperatura | 2 | 1.2 | `0CB40CCC10048B00FA` | oxígeno disuelto 11.63, doTemp 25.0 |
| DO sin temperatura | 2 | 1.2 | `0CB40CCC10048B` | oxígeno disuelto 11.63, doTemp `null` |
| ORP negativo | 2 | 1.2 | `0CB40CCC08FF9C` | ORP −100 |
| Firmware 1.3.3 | 2 | 1.3.3 | cualquiera | error "formato no soportado" |
| Datalog en 1.3.3 | 3 | 1.3.3 | cualquiera | error o registro ignorado: esta versión no tiene datalog |

> Nota: se asume que `ecTemp` y `doTemp` se dividen por 10, igual que `PH_temp` en el ejemplo del PDF. Confirmar con un uplink real.

---

## Tarea 2 — Ajustes a `ttnUplink` (`lorawanAdapter.ts`)

1. Decodificar `uplink_message.frm_payload` (base64) con `wqsDecoder`. **Ignorar `decoded_payload`.**
2. **FPort 5:** actualizar `dispositivos/{deviceId}.hardware` (`firmware`, `banda`, `bateriaV`, `ultimoEstado`). No requiere ciclo en curso.
3. **FPort 2:** leer `dispositivos/{deviceId}.hardware.firmware` para elegir el formato. Si no hay firmware registrado, asumir el formato de 1 byte y registrar un warning.
4. Usar `uplink_message.received_at` como `ts` de la lectura, no la hora del servidor.
5. ID de documento determinista: `{devEui}_{tsEnSegundos}`, para que los reintentos de TTN no dupliquen lecturas.
6. Guardar `devEui` en `dispositivos` y verificar que `end_device_ids.dev_eui` coincida con el registrado. Si no coincide, ignorar con 200 y registrar un log.
7. Guardar en la lectura el payload crudo (`hex`, `fPort`, `fCnt`) y `decoderVersion`.
8. Mantener todos los valores como `number` o `null`, nunca strings.

Actualizar `Aplicación/stormcip/scripts/simulador-ttn.js` para que envíe `frm_payload` real (los payloads de la Tarea 1 en base64) en vez de un `decoded_payload` armado a mano. Actualizar `seed.js` si se agregan campos a `dispositivos` (`devEui`, `hardware`).

---

## Tarea 3 — Catálogo (`types.ts`)

1. Separar en `CATALOGO_SONDAS` lo que la sonda mide de lo que **el payload realmente envía**. Temperatura en el payload: sí para EC_K1, EC_K10 y pH; no para oxígeno disuelto, ORP ni turbidez.
2. Agregar `DR-TS1` (turbidez 0–1000 NTU).
3. Renombrar la variable `cloroResidual` a `cloroLibre` (el manual, FAQ 8.5, indica que la sonda mide solo cloro libre). Revisar si hay datos, umbrales o referencias en `web/` que migrar.
4. Agregar las variables `phTemp`, `ecTemp` y `tempExterna`.
5. Hacer que las sondas soportadas dependan del formato de firmware: en los formatos A y B, solo DR-PH01, DR-ECK1.0, DR-ECK10.0, DR-ORP1, DR-DO1 y DR-TS1 (esta última por inferencia del changelog). DR-TS200, DR-TS4000, DR-EC200 y DR-CL-* requieren 1.3.1+; DR-COD y DR-DO2 requieren 1.3.3. Todas estas quedan sin soporte hasta conocer el mapa del flag de 2 bytes. Dejar un comentario explicándolo.
6. Revisar `seed.js`: usa DR-TS200, que según el changelog solo existe desde el firmware 1.3.1. Proponer si cambiarlo a DR-TS1 o dejarlo marcado como pendiente.

---

## Tarea 4 — Actualizar `Base de datos/modelo-datos-sensores.md`

- Sección 5.1: agregar la tabla de historial del firmware de este documento, los campos `_temp` de FPort 2 y la nota del flag de 2 bytes desde el firmware 1.3.1.
- Sección 5.2: reemplazar el "pendiente real". CL y COD **sí son compatibles** a nivel de hardware; lo pendiente es el mapa de bits del flag de 2 bytes y el tamaño de cada valor. Lo mismo aplica a DR-EC200.
- Sección 5.3: documentar el decoder propio y por qué se dejó de usar `decoded_payload`.
- Sección 5.4: dejar escrito que FPort 3 (datalog) queda fuera del alcance actual, porque asignar "el ciclo en curso ahora" a lecturas atrasadas sería incorrecto, y porque el firmware 1.3.3 eliminó el datalog.
- Sección 6: agregar como pendiente revisar con el cliente las condiciones de operación de las sondas (temperatura 0–60 °C en general, 0–40 °C para turbidez y COD, pH 4–9 para cloro) frente a las etapas calientes y químicas del CIP.

---

## Decisiones pendientes (NO implementar sin confirmación)

- Estrategia de firmware para los equipos reales: pedir a Dragino el mapa del flag de 2 bytes (1.3.x), fijar los equipos en firmware 1.2 (formato documentado, pero sin CL, COD, EC200 ni TS200/TS4000), o deducir el mapa de bits conectando una sonda a la vez.

- Guardar lecturas fuera de ciclo con `cicloId: null` y sin alertas de proceso, en vez de ignorarlas.
- Procesar FPort 3 (datalog) asignando el ciclo por ventana de tiempo.
- Migrar `TTN_WEBHOOK_SECRET` a Secret Manager.
