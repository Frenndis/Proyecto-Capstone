# Plan de pruebas — StormCIP

**Habilitador:** HT-04 (Calidad: pruebas automatizadas, integrales, de carga, UAT y corrección de errores).
**Criterio de aceptación:** plan de pruebas con evidencia por sprint y UAT aprobada.
**Versión probada:** commit `44205a9` (rama `main`) · **Fecha de ejecución:** 23-11-2026 (Sprint 7).
**Responsable de QA:** Felipe Carreño.

Este documento dice qué se prueba, cómo, con qué resultado y dónde está la evidencia.
El acta de aceptación está en [`acta-uat.md`](acta-uat.md).

## 1. Resumen del resultado

| Nivel | Qué cubre | Resultado del 23-11-2026 | Evidencia |
|---|---|---|---|
| Unitarias del backend | Decoder WQS-LB, ingesta, indicadores, volumen, química, proyección, modelos, planes | **316 de 316 pasan** (17 archivos) | [`unitarias-functions.log`](evidencia/unitarias-functions.log) |
| Unitarias de la web | Etapas, tarjetas, series, proyección, tendencia y avisos | **206 de 206 pasan** (11 archivos) | [`unitarias-web.log`](evidencia/unitarias-web.log) |
| Reglas de seguridad | Permisos de Firestore por rol | **20 de 20 pasan** | [`reglas-firestore.log`](evidencia/reglas-firestore.log) |
| Integración del webhook | 8 casos contra `ttnUplink`, incluida la idempotencia | **8 de 8 con la respuesta esperada** | [`integracion-ttn.log`](evidencia/integracion-ttn.log) |
| Punta a punta | Volumen circulado y concentración química, de la lectura a Firestore | **2 de 2 «Todo OK»** | [`e2e-volumen.log`](evidencia/e2e-volumen.log), [`e2e-quimica.log`](evidencia/e2e-quimica.log) |
| Carga | Lecturas seguidas a `ingestLectura` sin pérdidas | **Pasa con 1 y 3 envíos simultáneos; falla con 10** (hallazgo H-01) | [`carga-ingesta.log`](evidencia/carga-ingesta.log) |
| Aceptación (UAT) | 38 criterios de las historias de usuario, con los tres roles | **38 de 38 pasan**, en emuladores | [`uat-recorrido.log`](evidencia/uat-recorrido.log) y [`capturas/`](evidencia/capturas) |

Total automatizado: **542 pruebas unitarias y de reglas**, más 10 escenarios de integración y 38 de aceptación.

**Lo que este resultado no cubre** (detalle en la sección 7):

- Todo se ejecutó contra los **emuladores de Firebase con datos simulados**. No hay pruebas con la maqueta ni con los sensores reales.
- No se midió rendimiento en producción (RNF-06) ni estabilidad de 8 horas (RNF-08).
- El UAT lo ejecutó QA con un recorrido automatizado. **Falta la aprobación del cliente o del dueño del producto**: el acta está lista para firmar.

## 2. Alcance

**Dentro del alcance:** backend (`functions/`), web (`web/`), reglas de Firestore (`firestore.rules`) y scripts de simulación (`scripts/`).

**Fuera del alcance de este plan:** calibración y montaje de sensores (HT-03, a cargo del técnico), la consola de The Things Stack y el gateway físico.

## 3. Estrategia: niveles de prueba

| Nivel | Herramienta | Cuándo se corre | Cómo |
|---|---|---|---|
| Unitarias | Vitest | En cada cambio | `npm test` en `functions/` y en `web/` |
| Reglas de seguridad | Vitest + `@firebase/rules-unit-testing` | Al tocar `firestore.rules` | `npm run test:reglas` en `functions/`, con el emulador de Firestore |
| Integración | Scripts de `scripts/` contra los emuladores | Antes de cada despliegue | `npm run seed` y `npm run sim:ttn` |
| Punta a punta | `e2e-volumen.js`, `e2e-quimica.js` | Antes de cada despliegue | `node e2e-volumen.js`, `node e2e-quimica.js` |
| Carga | `carga-ingesta.js` (nuevo, Sprint 7) | Sprint 7 y ante cambios de la ingesta | `node carga-ingesta.js --lecturas 150 --paralelo 3` |
| Aceptación | `uat-recorrido.js` (nuevo, Sprint 7) y revisión manual | Sprint 7, antes de la demo | `node uat-recorrido.js <carpeta>` con la web local |
| Humo en producción | Pasos 4.1 a 4.3 de `DESPLIEGUE.md` | Después de cada despliegue | Manual |

Los scripts de carga y de aceptación solo aceptan emuladores y direcciones locales: se niegan a correr contra producción.

## 4. Ambientes

| Ambiente | Uso | Datos |
|---|---|---|
| Emuladores (`stormcip-dev`) | Todas las pruebas de este plan | `seed.js` (usuario admin y dispositivos de prueba) y `sembrar-planta.js` (882 ciclos simulados de 8 circuitos) |
| Producción (`stormcip-austral`) | Demo y prueba de humo | Planta de demostración simulada; sin sensores reales conectados |

Requisitos locales: Node 22, Firebase CLI y **Java 21 o superior**. El 23-11 `firebase-tools` 15 rechazó Java 17; se usó un JDK 25.

## 5. Trazabilidad: historias de usuario y pruebas

| Historia | Pruebas que la cubren | Estado |
|---|---|---|
| HU-01 Lecturas en tiempo real | `tarjetas.test.ts`, `catalogo.test.ts`, `tipos.test.ts`; UAT-21 | Cubierta con datos simulados |
| HU-02 Etapa y tiempo del ciclo | `etapas.test.ts`, `relojCiclo.test.ts`; UAT-12 | Cubierta |
| HU-03 Alertas fuera de rango | `ingest.test.ts`, `ingestTx.test.ts`, `tendencia.test.ts`; UAT-14 | Cubierta |
| HU-04 Historial por variable y periodo | `tendencia.test.ts` (`segmentosPeriodo`), `serieTendencia.test.ts`; UAT-05 a UAT-09 | Cubierta |
| HU-05 Consumo de agua y químicos | `volumenCirculado.test.ts`, `concentracion.test.ts`, `e2e-volumen.js`, `e2e-quimica.js`; UAT-18 | Cubierta con datos simulados |
| HU-06 Indicadores al cerrar el ciclo | `ciclos.test.ts`, `calculos.test.ts`; UAT-16, UAT-17 | Cubierta |
| HU-07 Proyección y avisos de tendencia | `proyeccionEnjuague.test.ts`, `tendencia.test.ts`, `ml.test.ts`; UAT-11, UAT-13, UAT-15, UAT-19 | Cubierta con datos simulados |
| HU-08 Sesión y permisos por rol | `firestore.rules.test.ts`; UAT-01 a UAT-03, UAT-31 a UAT-38 | Cubierta |
| HU-09 Asignar roles | UAT-27 a UAT-30 | Cubierta por UAT; sin prueba unitaria de las funciones de usuarios |
| HU-10 Estado de cada equipo | `estadoDispositivo.test.ts`; casos 6 a 8 de `sim:ttn` | Lógica cubierta; falta el primer FPort 5 de un equipo real |
| HU-11 Simulación controlada | `modeloCip.test.ts`, `controlSimulacion.test.ts`, `planta.test.ts`; UAT-10 | Cubierta |
| HU-12 Lecturas automáticas del sensor | `wqsDecoder.test.ts`, `wqsEncoder.test.ts`, `mapeoWqs.test.ts`; `sim:ttn` | Cubierta con payloads simulados; **sin sensor real** |
| Planes de limpieza (gestión) | `planes.test.ts`; UAT-22 a UAT-26 | Cubierta |

Requisitos no funcionales:

| Requisito | Verificación | Resultado |
|---|---|---|
| RNF-01 Acceso por rol | 20 tests de reglas y UAT-31 a UAT-38 | Cumple. Sigue pendiente limitar qué campos del ciclo puede escribir el operador |
| RNF-03 Solo dispositivos registrados | Casos 3 y 8 de `sim:ttn` («dispositivo desconocido») | Cumple |
| RNF-04 Idempotencia | Caso 5 de `sim:ttn` | Cumple en `ttnUplink`. No en `ingestLectura` (hallazgo H-02) |
| RNF-05 Rango físico | `ingest.test.ts` y `wqsDecoder.test.ts` | Cumple |
| RNF-06 Rendimiento | — | **Sin medir en producción** |
| RNF-07 Carga | `carga-ingesta.js` | Cumple hasta 3 envíos simultáneos por ciclo; falla con 10 (H-01) |
| RNF-08 Disponibilidad | — | **Sin prueba de estabilidad de 8 h** |
| RNF-11 Mantenibilidad | 542 pruebas automatizadas; guardarraíles de `scripts/entorno.js` | Cumple |

## 6. Evidencia por sprint

La columna «Pruebas agregadas» sale del historial de git: la fecha es la del commit que creó cada archivo.
La columna «Resultado hoy» es la corrida del 23-11-2026 sobre el commit `44205a9`: demuestra que lo entregado en ese sprint sigue funcionando (regresión).

| Sprint | Entregable del sprint | Pruebas agregadas en el sprint | Resultado hoy |
|---|---|---|---|
| 1 (24-08 a 06-09) | Proyecto Firebase, modelo de datos, reglas por rol | Ninguna automatizada. La *Definition of Done* de `SPRINT1.md` se verificó a mano con los emuladores | Sus criterios hoy los cubren `ingest.test.ts` (rechazo de datos inválidos) y los 20 tests de reglas |
| 2 (07-09 a 20-09) | Autenticación, web base, `ingestLectura` | Ninguna automatizada | Login y roles: UAT-01 a UAT-03 pasan |
| 3 (21-09 a 04-10) | Webhook LoRaWAN, decoder WQS-LB, cierre de ciclo | `ingest.test.ts` y `wqsDecoder.test.ts` (26-09, `cc59b42`), `simulador-ttn.js` (26-09, `b22a97b`), `ciclos.test.ts` (01-10, `831c580`), `tipos.test.ts` (01-10, `103fc10`) | 39 + 19 + 15 + 28 tests pasan; 8 casos de `sim:ttn` correctos |
| 4 (05-10 a 18-10) | Saturación y sonda EC, estado del equipo, simulador CIP, dashboard por etapas, reglas | `calculos`, `mapeoWqs`, `ingestTx`, `estadoDispositivo`, `modeloCip`, `relojCiclo`, `wqsEncoder` (09-10); `controlSimulacion`, `etapas`, `catalogo`, `tarjetas`, `serieTendencia` y `firestore.rules.test.ts` (14-10) | 5 + 4 + 9 + 12 + 30 + 8 + 11 + 14 + 24 + 30 + 1 + 25 + 25 + 20 tests pasan |
| 5 (19-10 a 01-11) | Volumen circulado, concentración química, proyección del enjuague | `volumenCirculado.test.ts` (backend y web), `concentracion.test.ts`, `historialPlanta.test.ts`, `e2e-volumen.js`, `e2e-quimica.js` (26-10); `proyeccionEnjuague.test.ts` (backend y web, 01-11) | 27 + 24 + 28 + 5 + 45 + 8 tests pasan; las dos pruebas de punta a punta terminan «Todo OK» |
| 6 (02-11 a 15-11) | Planta de demostración y modelos Random Forest | `ml.test.ts`, `planta.test.ts` (backend y web) (02-11, `3c16157`) | 17 + 18 + 18 tests pasan |
| 7 (16-11 a 29-11) | Gráfico por variables y periodo, proyección con confianza, avisos de tendencia, usuarios y planes | `planes.test.ts` y `tendencia.test.ts` (23-11, `44205a9`); `carga-ingesta.js` y `uat-recorrido.js` (23-11) | 15 + 18 tests pasan; carga con el resultado de la sección 1; UAT 38 de 38 |

Antecedente: el 18-10-2026 el plan del proyecto registró 291 tests (158 en backend y 133 en web). Hoy son 522 unitarios más 20 de reglas.

## 7. Hallazgos y limitaciones

| ID | Hallazgo | Severidad | Estado |
|---|---|---|---|
| H-01 | Con 10 envíos simultáneos al mismo ciclo, `ingestLectura` rechazó 126 de 300 lecturas con error 500. El log del emulador muestra «Transaction lock timeout» y reinicios del proceso de funciones. La ingesta actualiza el documento del ciclo en cada lectura, así que las escrituras al mismo ciclo se serializan | Media | **Abierto.** No afecta el uso previsto (un WQS-LB envía una lectura cada 20 min), pero limita cuántos equipos pueden escribir a la vez en una línea. Falta repetir la prueba en producción: el emulador no representa a Firestore real |
| H-02 | `ingestLectura` (endpoint HTTP usado por simuladores) no es idempotente: reenviar una lectura crea otro documento. `ttnUplink`, el camino del sensor real, sí lo es | Baja | Abierto, documentado. RNF-04 se cumple en el camino real |
| H-03 | En el emulador, una contraseña incorrecta muestra «No se pudo iniciar sesión. Revisa tu conexión…» en vez de «Correo o contraseña incorrectos». La web solo reconoce el código `auth/invalid-credential` | Baja | Abierto. Por confirmar si ocurre en producción |
| H-04 | A 20× de velocidad, la caída de temperatura de la demo cruza el mínimo unos 13 s de proceso después de empezar: el aviso «tiende a salir de rango» aparece una o dos lecturas antes de «fuera de rango». En una corrida la confianza fue 68 % y en otra 83 % | Informativo | Comportamiento esperado de la demo acelerada |
| H-05 | Con una ventana de 1280 px de ancho, la hoja de Registros se superpone al panel derecho. A 1440 px se ve bien | Baja (visual) | Abierto |
| H-06 | Los avisos de tendencia se calculan en el navegador y no se guardan en la colección `alertas` | Informativo | Decisión de diseño; registrada en el manual |

Pendientes de prueba, todos dependientes de la maqueta:

- Lecturas reales del WQS-LB por The Things Stack (HU-12) y primer uplink de estado FPort 5 (HU-10).
- Consumo de agua medido con el flujómetro real (HU-05).
- Validación de los modelos con datos reales (HU-07): hoy se entrenan y miden con ciclos simulados.
- Prueba de estabilidad de 8 horas (RNF-08) y medición de latencia en producción (RNF-06).

## 8. Criterios de salida

| Criterio | Estado al 23-11-2026 |
|---|---|
| Todas las pruebas unitarias y de reglas pasan | Cumplido |
| Integración y punta a punta sin fallas | Cumplido |
| Carga: sin pérdida de lecturas en el uso previsto | Cumplido hasta 3 envíos simultáneos; H-01 abierto |
| Sin hallazgos de severidad alta abiertos | Cumplido |
| UAT ejecutada y aprobada | Ejecutada (38 de 38). **Aprobación pendiente de firma** |
| Pruebas con la maqueta y sensores reales | **No cumplido**: depende de HT-03 |

## 9. Cómo repetir las pruebas

Desde `Evidencias de sistema/Aplicación/stormcip/`, con los emuladores levantados (`firebase emulators:start --project stormcip-dev --only auth,functions,firestore`):

```bash
cd functions && npm test && npm run test:reglas
cd ../web && npm test
cd ../scripts && npm run seed && npm run sim:ttn
node e2e-volumen.js && node e2e-quimica.js
node carga-ingesta.js --lecturas 150 --paralelo 3
node sembrar-planta.js
# con la web local en http://localhost:3000 (npm run dev en web/):
node uat-recorrido.js "../../../../Evidencias de documentación/Plan de pruebas/evidencia/capturas"
```

`uat-recorrido.js` espera datos recién sembrados: crea el plan «Tina 3 · quesería» y dos cuentas de prueba, así que antes de repetirlo hay que reiniciar los emuladores y volver a sembrar.
