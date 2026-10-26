# StormCIP — contexto para agentes de IA

Este archivo es la fuente de contexto del repositorio de aplicación. Léelo antes de editar código. El idioma de la UI, comentarios y este documento es **español**.

## Qué es

StormCIP es un sistema IoT de **monitoreo de procesos CIP** (Clean-In-Place: limpieza in situ de líneas, estanques y camiones cisterna) para una planta láctea (cliente de referencia: Soprole / planta Frutillar; proveedor de químicos: Austral Chemicals).

**Alcance real del MVP:** monitoreo de **enjuagues** (preenjuague, enjuague, enjuague final) con sondas de calidad de agua Dragino WQS-LB. **No** es monitoreo de etapas químicas (alcalino, ácido, desinfección): ahí las sondas WQS trabajan fuera de su rango físico (pH/EC hasta 60 °C, turbidez hasta 40 °C) y mezclar esos datos ensucia la curva de conductividad.

No hay caudalímetro en planta. El volumen se **estima** con caudal nominal de bomba. Un valor estimado **nunca** debe verse igual que uno medido (borde punteado, color ámbar y prefijo `≈`; el método va visible, no en tooltip).

El plan de proyecto todavía habla a veces de “consumo de químicos” y de un caudalímetro. El código **ya no asume** eso. No reintroducir esas promesas.

## Stack

| Capa | Tecnología |
|---|---|
| Front | Next.js 16 (App Router) + React 19 + Tailwind 4 + Recharts. **Export estático** (`output: "export"` en `web/next.config.js`) → `web/out` → Firebase Hosting. Node 22. |
| Auth / datos | Firebase Auth (email/password) + Firestore. Custom claim `rol`. |
| Backend | Cloud Functions Node 22 (`functions/`), región por defecto `southamerica-west1`. |
| Hardware | Dragino **WQS-LB** LoRaWAN + sondas RS485. Gateway: The Things Stack (TTN). |
| Local | Emuladores Firebase (Auth 9099, Functions 5001, Firestore 8080, Hosting 5000, UI 4000). |

Proyectos Firebase:

- Emuladores / desarrollo: `stormcip-dev` (`scripts/config.js`; se puede sobreescribir con `PROJECT_ID`).
- Producción: `stormcip-972bd`. URL pública: https://stormcip-972bd.web.app
- `.firebaserc` apunta `default` a producción. **Siempre** pasar `--project` explícito. No confiar en el proyecto “activo” del CLI.

## Estructura del repo

```
stormcip/
├─ AGENTS.md                 # este archivo
├─ README.md                 # cómo probar emuladores + ttnUplink
├─ DESPLIEGUE.md             # producción: flags, secretos, orden de deploy
├─ SPRINT1.md / SPRINT3.md   # contexto histórico de sprints (no son spec viva)
├─ firebase.json             # Firestore, Functions, Hosting, emuladores
├─ firestore.rules
├─ firestore.indexes.json
├─ functions/src/            # Cloud Functions (TypeScript → lib/)
├─ scripts/                  # seed, simuladores, herramientas Admin SDK
└─ web/                      # dashboard Next.js
```

`web/AGENTS.md` y `web/CLAUDE.md` los regenera `next dev` (reglas genéricas de Next 16). **No** son el contexto de dominio.

## Flujo del dato

```
Sonda WQS-LB → LoRaWAN → The Things Stack
                         → POST ttnUplink (header x-webhook-secret)
                         → wqsDecoder + mapeoWqs
                         → procesarLectura (ingest.ts)
                         → Firestore (ciclos/.../lecturas, alertas, ultimaLectura)
                         → dashboard (onSnapshot)

Camino legado (ESP32 / simulador HTTP):
  POST ingestLectura  (header x-api-key, JSON con valores ya decodificados)
  → mismo procesarLectura()
```

Rewrites de Hosting: `/api/ingest` → `ingestLectura`, `/api/ttn-uplink` → `ttnUplink`.

La **etapa no la decide el dispositivo**. `procesarLectura` usa `ciclo.etapaActual`. El campo `etapa` del body HTTP se ignora (queda un warn si no coincide).

Sin ciclo `en_curso` en la línea del dispositivo, el uplink se **ignora** (200 + `ignorado`, no 4xx) para que TTS no reintente en bucle. Solo secreto inválido → 401 y método incorrecto → 405.

## Dominio CIP

Etapas (`functions/src/types.ts` → `ETAPAS`):

`preenjuague` → `alcalino` → `enjuague` → `acido` → `enjuague_final` → `desinfeccion`

Etapas **monitoreadas** (`ETAPAS_MONITOREADAS`): `preenjuague`, `enjuague`, `enjuague_final`.

Líneas que el dashboard conoce (`web/src/lib/lineas.ts`):

- `cip-01` — línea real (equipo WQS físico).
- `cip-sim` — línea de demo. La simulación **nunca** debe mezclarse con la real: `ttnUplink` asigna lecturas al ciclo en curso de la línea del dispositivo.

Roles: `admin` | `operador` | `visor`. Un usuario nuevo parte como `visor` (`onUserCreated`). Solo admin llama `setUserRole`. El dashboard actual está envuelto en `GuardRol roles={["admin"]}`.

## Modelo de datos (Firestore, esquema v2)

`ESQUEMA_VERSION = 2`. Mediciones en `valores`, cálculos en `derivados`. Cada derivado declara `metodo` y `confianza`.

**Confianza:** `medido` | `estimado` | `saturado` | `fuera_de_operacion`.

- `saturado`: la sonda topó su rango de medición; el valor guardado es el tope y el real es ≥. Los derivados son cota inferior.
- `fuera_de_operacion`: midió sobre `tempMaxOperacion` de la sonda; se guarda pero **no** entra a derivados, umbrales ni indicadores.
- `null` en un valor = sensor no conectado (centinela DS18B20), no dato inválido.

### Colecciones

| Ruta | Quién escribe | Notas |
|---|---|---|
| `users/{uid}` | `onUserCreated` / `setUserRole` | email, nombre, rol |
| `plantas/{id}/lineas/{id}` | admin / seed | `cip-01`, `cip-sim` |
| `ciclos/{id}` | operador (estado) + backend | `ultimaLectura` por deviceId; indicadores al cerrar |
| `ciclos/{id}/lecturas/{id}` | solo backend | ID determinista para idempotencia TTN |
| `alertas/{id}` | solo backend; operador reconoce | una por ciclo+etapa+variable (`idAlerta`) |
| `dispositivos/{id}` | solo backend / Admin SDK | clientes **no** leen (salvo admin). Incluye `sondas` mapa, `firmware`, `devEui`, `apiKeyHash` |
| `estadoProceso/{lineaId}` | solo backend (simulador CIP) | un doc por línea, se **sobrescribe** cada tick; sin historial. “Detenido” si no actualiza en 10 s |
| `simulacionControl/{lineaId}` | admin (forma estricta) | comando `iniciar`/`detener` + escenario `normal`/`falla` |
| `simulacionEstado/{lineaId}` | simulador | latido |
| `configuracion/umbrales` | admin | rangos de **proceso** por etapa y variable (distintos del rango físico de la sonda) |
| `configuracion/calculos` | admin | supuestos: `factorCompensacionEC` 0.02, `conductividadAguaRed` 150, `caudalNominalM3h` 18, `criterioLimpio` `{ conductividad25C: 200, turbidez: 10 }` |

Ciclo: `estado` = `en_curso` | `finalizado` | `abortado`. No hay delete: borrar dejaría lecturas huérfanas.

`variablesVistas` (por deviceId) **solo crece**: el dashboard arma tarjetas con eso para que una variable descartada en una lectura no desaparezca de pantalla.

Indicadores de ciclo (los escribe `alCerrarCiclo` al pasar a `finalizado`, o si se pone `recalcular: true`):

- `tiempoHastaLimpio` (s)
- `arrastreQuimico` (µS/cm)
- `pendienteConductividad` (µS/cm/min)
- `volumenEstimado` (m³) — **suma del volumen por etapa**, no el lapso completo (entre preenjuague y enjuague final hay etapas químicas sin agua de enjuague)

También: `indicadoresMetodo`, `indicadoresConfianza`, `indicadoresPorEtapa`, `lecturasConsideradas`, `indicadoresCalculadosEn`.

Estados de UI de indicadores (`estadoIndicadores` en `web/src/lib/tipos.ts`): `pendiente` | `sin_lecturas` | `sin_valores` | `listo`. No reducir a “hay datos / no hay datos”.

### Hardware / catálogo de sondas

El catálogo **no va en Firestore**. Vive en `functions/src/types.ts` (`CATALOGO_SONDAS`) y hay una **copia** en `web/src/lib/catalogo.ts` porque el export estático de Next no resuelve archivos fuera de `web/`. `catalogo.test.ts` falla si se desfasan: al cambiar el backend, actualizar la copia.

Equipo comprado (cotización Altronics): WQS-LB firmware **1.2**, sondas activas **DR-PH01** + **DR-ECK1.0**. Sin turbidez ni DS18B20 en el equipo real. Decoder propio: `wqsDecoder.ts`. Firmware 1.3.x **no soportado** todavía.

`sondas` es un **mapa**, no un array. Cada sonda necesita `activa: true` o `specDe()` no encuentra spec y la ingesta responde 400 “Sin variables válidas”.

`caudal`, `presion`, `concentracion`, `nivel` están en `VARIABLES` pero **ningún** modelo del catálogo las provee por ingesta WQS. El estado de planta (PLC / simulador) las pone en `estadoProceso.instrumentos` y estanques. No inventar un modelo de sonda para “hacerlas pasar” por `procesarLectura`.

## Backend (`functions/src`)

| Archivo | Rol |
|---|---|
| `index.ts` | Exporta triggers. Región global west1. |
| `http.ts` | `ingestLectura` — autentica API key (hash SHA-256 vs `apiKeyHash`) y traduce. |
| `lorawanAdapter.ts` | `ttnUplink` — secreto `TTN_WEBHOOK_SECRET` (`defineSecret`). FPort 2 = lectura, FPort 5 = estado (firmware/batería), resto ignorado. **No** usar `decoded_payload` de TTN (decoder oficial Dragino es fw ≤ 1.1). |
| `ingest.ts` | `procesarLectura`: validar rangos físicos, derivados, alertas, `ultimaLectura`, idempotencia. |
| `calculos.ts` | Funciones **puras**: EC25, derivados por lectura, `derivarCiclo`. |
| `ciclos.ts` | `alCerrarCiclo` (onDocumentUpdated), callable `recalcularIndicadores`. Tope 5000 lecturas. |
| `wqsDecoder.ts` / `wqsEncoder.ts` | Payload binario WQS. |
| `mapeoWqs.ts` | Payload decodificado → `valores` del modelo. |
| `estadoDispositivo.ts` | FPort 5: `firmwareReportado` (no pisa `firmware`). |
| `auth.ts` | `onUserCreated` (v1, **southamerica-east1** — west1 no admite 1ª gen), `setUserRole`. |
| `simulacion/` | Reloj de ciclo, modelo físico CIP, control de simulación. |

El emulador de Functions sirve `functions/lib/`, **no recompila** TypeScript. Tras cada cambio: `npm run build` o `npm run build:watch`. Si no, el log “Serving…” miente y corre código viejo.

`onUserCreated` en región incorrecta puede **tumbar el deploy de otras funciones**: el CLI evalúa todo `index.ts` antes del filtro `--only`.

Tests: `npm test` en `functions/` (Vitest, sin emulador). `npm run test:reglas` necesita Firestore emulator en 8080 y **no** está incluido en `npm test`.

## Front (`web/src`)

Hay **tres superficies de UI**. No mezclar componentes ni datos entre ellas.

| Ruta | Qué es | Datos |
|---|---|---|
| `/login` + `/dashboard` | **Interfaz operativa actual.** Es lo que está desplegado y se usa en la demo. Tailwind utilitario, sin el shell del panel. | Firestore en tiempo real (`onSnapshot`) |
| `/(panel)/monitoreo`, `/historial`, `/configuracion` | **Armazón nuevo** (sidebar + header). El grupo `(panel)` no aparece en la URL. Contenido = placeholder “pendiente”. | Casi nada: header con línea fija `CIP-01` (`web/src/lib/linea.ts`) |
| `/mockup` | **Prototipo visual** (diagrama CIP, KPIs, SVGs). Para enseñar look & feel. | `useSimulacionCip` + `mock-cip.ts`: números que oscilan en el navegador. **Cero Firebase.** |

La interfaz que hay que preservar y extender para operación real es `/dashboard`. El mockup (`web/src/components/monitoreo/*`) no está cableado a Firestore; copiar un SVG de ahí al dashboard está bien, copiar su “telemetría” no.

Hosting es estático (`output: "export"`): **no hay middleware**. Sesión y rol se cortan en cliente (`GuardRol`). `cleanUrls: true` es obligatorio (el export emite `dashboard.html` en la raíz). Firebase client: `web/src/lib/firebase.ts`. Emuladores si `NEXT_PUBLIC_USE_EMULATORS=true`. Functions client: `southamerica-west1`.

`web/.env.local` = desarrollo. Hosting de producción: `web/.env.production.local` (gitignored) + `scripts/verificar-build-web.js` antes de desplegar.

Tipos de UI: `web/src/lib/tipos.ts` (espejo del backend, no import cruzado). Lógica de presentación pura (testeable): `tarjetas.ts`, `etapas.ts`, `serieTendencia.ts`, `controlSimulacion.ts`.

## Cómo funciona la interfaz operativa (`/dashboard`)

La página es un cliente React. No calcula indicadores ni valida sondas: **muestra lo que Firestore ya tiene** y se re-renderiza sola cuando llega un snapshot.

### Sesión

1. `AuthProvider` (layout raíz) escucha `onAuthStateChanged` y lee el custom claim `rol` con `getIdTokenResult(true)`.
2. `/` manda a `/dashboard` si hay usuario, si no a `/login`.
3. Login: email/password de Firebase Auth. Tras éxito → `/dashboard`.
4. `GuardRol roles={["admin"]}` envuelve el dashboard: sin sesión → `/login`; con sesión pero sin rol pedido → pantalla “Sin permisos” (no redirige al dashboard para no buclar). Hoy **solo admin** entra; operador/visor existen en Auth y reglas, no en esta vista.
5. Salir = `signOut`.

### Selector de línea

Arriba a la derecha: Todas / Planta (`cip-01`) / Demo (`cip-sim`). Se recuerda en `localStorage` (`stormcip.linea`) vía `useSeleccionLinea` (`useSyncExternalStore` para no romper la hidratación del export estático).

`useCicloMostrado(linea)`:

- Si hay ciclo `en_curso` de esa línea → se muestra y `enVivo = true` (título “Monitoreo en vivo”).
- Si no → último `finalizado` (no `abortado`: no tiene indicadores). Título “Último ciclo cerrado” + aviso de que las tarjetas no son datos de ahora.
- Sin ciclos: empty state pidiendo seed + simulador.

El control de simulación **solo aparece** si la selección no es “real” (`seleccion !== "real"`), para no disparar la demo sobre el equipo físico. El botón siempre opera sobre `cip-sim`, no sobre la línea del selector.

### Orden de la pantalla (arriba → abajo)

1. **Cabecera** — email, rol, selector de línea, salir.
2. **Simulación de la demo** (`ControlSimulacion`) — latido vivo/apagado, escenario Normal/Falla, Iniciar / Detener. La web **no crea ciclos**: escribe `simulacionControl/cip-sim`. Si el simulador no corre (`npm run sim:cip -- --esperar`), el botón explica que está apagado.
3. **Ficha del ciclo** — id, línea, camión, etapa (etiqueta humana), estado, equipo, inicio/fin (`es-CL`).
4. **Barra de etapas** (`BarraEtapas`) — las 6 etapas en orden. Actual = azul; hechas = verde con ✓; pendientes = gris. Etapas químicas con **borde punteado** (no monitoreadas). Tiempo del ciclo sale de `inicio`/`fin`; tiempo en etapa y restantes **solo** de `estadoProceso` (el ciclo no guarda duraciones). Sin PLC/simulador: “sin dato”.
5. **Avisos de honestidad**
   - Ciclo cerrado: no leer las tarjetas como vivo.
   - Etapa química en vivo (`etapaFueraDeAlcance`): valores de sonda no confiables (> 60 °C; turbidez 40 °C si hubiera sonda).
6. **Tarjetas de sonda** (`TarjetaSonda`) — grid 2/3 columnas. El set **no es fijo**: `variablesAMostrar(variablesVistas, sondas)`. Orden: `conductividad25C`, `conductividad`, `tempEc`, `ph`, … Si hay conductividad, siempre hay tarjeta de EC25 (aunque no se haya podido calcular: hay que explicar por qué). Estados: `normal` / `saturado` (≥ tope) / `fuera_operacion` (opacidad) / `sin_compensar` / `sin_dato` (motivo de `descartadas`, “sensor no conectado”, o “no llegó”). Rojo si viola umbral de **alerta de la etapa** (`configuracion/umbrales`), no el criterio de limpio. Insignias: calculado, saturado, cota inferior, sin compensar.
7. **Estado de planta** (`PanelesProceso`) — instrumentos (temp. ida, concentración, caudal, presión), estanques (soda/ácido/agua recuperada), circuito (origen, retorno, bomba). Insignia **Simulado** si `simulado: true`. Badge “sin señal” si el doc no se actualiza en 10 s; el panel se atenúa. Si el doc es de otro `cicloId`, no se muestra (`procesoDelCiclo`).
8. **Tendencia** (`GraficoTendencia` + Recharts) — selector entre variables graficables presentes. Eje X = tiempo real del ciclo (inicio → fin o “ahora” redondeado a 5 s). Línea recta, **sin interpolar ni suavizar**; se corta en huecos. Franjas: azul = etapa monitoreada, ámbar = química. Puntos: círculo azul medido; círculo hueco ámbar saturado; cruz gris fuera de operación. Líneas de umbral min/max si existen.
9. **Indicadores del ciclo** (`IndicadoresCiclo`) — los escribe el backend al cerrar. Cuatro estados de copy (`pendiente` / `sin_lecturas` / `sin_valores` / `listo`). Estimado ≠ medido: borde punteado + ámbar + `≈` + insignia + método visible. `tiempoHastaLimpio` no desaparece si falta: se explica que el enjuague final no quedó limpio. Desglose solo de etapas monitoreadas.
10. **Alertas activas** (`PanelAlertas`) — `reconocida == false`, orden por `hasta`. Badge `×N` si la condición se repitió. Admin/operador pueden **Reconocer** (solo esos 3 campos). Hoy el dashboard es admin, así que el botón se ve.
11. **Historial de alertas** (`HistorialAlertas`) — últimas 30 de todos los ciclos, solo lectura, con `cicloId` y sello Activa/Reconocida.

Alertas y historial están **fuera** del bloque “si hay ciclo”: se ven aunque no haya ciclo mostrado.

### De dónde sale cada número

| UI | Hook / origen |
|---|---|
| Ciclo mostrado | `useCicloMostrado` |
| Lecturas del gráfico | `useLecturas` (hasta 500, `ts` desc, se invierten para graficar) |
| Tarjetas | `ciclo.ultimaLectura` (la más reciente entre deviceIds) + `useSondasDispositivo` (admin; si falla, se muestran todas las vistas) |
| Umbrales de tarjeta/gráfico | `useUmbrales` → `configuracion/umbrales[etapaActual]` |
| Estado de planta / reloj de etapas | `useEstadoProceso` + `useAhora` |
| Alertas | `useAlertas` / `useHistorialAlertas` (no filtradas por línea ni ciclo) |
| Demo | `useControlSimulacion("cip-sim")` + `useCicloEnCursoId("cip-sim")` |

### Shell nuevo y mockup (no confundir)

- `AppShell` + `SidebarNav`: Monitoreo / Historial / Configuración. `AppHeader` muestra `CIP-01 · Recepción de camiones` fijo y `EstadoConexion`. Estilos: `styles/shell.css` + `tokens.css`. Las tres rutas todavía no reusan el dashboard.
- `/mockup`: layout `cip-*`, sidebar propia, diagrama SVG (`CipPipelineSvg`, estanques, camión). `useSimulacionCip` hace jitter cada 2 s sobre constantes de `mock-cip.ts`. No ejerce decoder, umbrales de Firestore ni `estadoProceso`. No es la simulación de `sim:cip`.

Idioma de la UI: español. Fechas/horas: `es-CL`. Tokens de color del shell no aplican al dashboard operativo (ese usa clases slate/amber/red de Tailwind).

## Scripts (`scripts/`)

Regla dura: **ningún script toca producción sin flags explícitos**. Sin flags usan emuladores o se niegan. No deciden destino por `PROJECT_ID` / `INGEST_URL`. Guardarraíles en `scripts/entorno.js`. Producción: `--prod --project stormcip-972bd`. Credenciales: `gcloud auth application-default login`.

| Script | Uso |
|---|---|
| `seed.js` | **Solo emuladores.** Nunca contra prod. Crea admin de prueba `admin@stormcip.dev` / `admin123`. |
| `seed-prod.js` | Prod: `--project stormcip-972bd --confirmar` |
| `simulador.js` | HTTP `ingestLectura` (emuladores) |
| `simulador-ttn.js` | 5 casos contra `ttnUplink` (emuladores) |
| `simulador-cip.js` (`sim:cip`) | Simulación de planta completa (ver sección siguiente). Requiere `TTN_WEBHOOK_SECRET` y `functions/lib` compilado. Sin `--esperar` no corre si la línea ya tiene ciclo abierto (el seed deja `CIP-2026-0001`: cerrarlo con `cerrar-ciclo.js`). |
| `simulador-prod.js` | Igual idea, solo con `--prod --project …` |
| `cerrar-ciclo.js`, `recalcular.js`, `rotar-key.js` | Herramientas; prod solo con flags |
| `produccion-plantilla.js` | Plantilla guiada; se niega si quedan `<COMPLETAR>` |
| `revisar-config-prod.js` | Solo lectura de config de prod |
| `verificar-build-web.js` | Valida `web/out` antes de Hosting |

## Simulación del proceso CIP

No es un mock del dashboard: recorre un ciclo físico comprimido y alimenta **los mismos pipelines** que la planta real. El modelo es función pura (`estadoEn(t)`), determinista (ruido por hash de semilla+canal+t, no RNG con estado).

### Dos canales, no uno

| Canal | Qué representa | Cómo entra | Dónde vive |
|---|---|---|---|
| Estado de planta | Lo que vendría del **PLC**: etapa, caudal, presión, temp. de ida, concentración, estanques, válvula de origen/retorno, bomba | Escritura Admin SDK cada `--tick` s (default 2; mínimo 1 por límite de Firestore) | `estadoProceso/{lineaId}` — un doc, **se sobrescribe entero** cada tick, sin historial |
| Calidad de retorno | Lo que mide el **WQS-LB** en la línea de retorno (pH + EC + temps de sonda) | Se **codifica** como uplink FPort 2 (`wqsEncoder`) y se POST a `ttnUplink` | Mismo camino que el equipo real: decoder → `procesarLectura` → lecturas/alertas/`ultimaLectura` |

El dashboard mezcla ambos: tarjetas/gráficos de sondas desde el ciclo; `PanelesProceso` desde `estadoProceso`. Si `actualizadoEn` tiene más de 10 s (`UMBRAL_DETENIDO_MS`) se considera detenido.

### Archivos

| Archivo | Rol |
|---|---|
| `functions/src/simulacion/modeloCip.ts` | Receta, hidráulica, curvas de calidad, `estadoEn(t)` |
| `functions/src/simulacion/relojCiclo.ts` | Reloj con **pausa** si el proceso se atrasa > 5 s (no hay ráfaga de uplinks al despertar) |
| `functions/src/simulacion/controlSimulacion.ts` | Decidir si una orden del dashboard se inicia, detiene, ignora o rechaza |
| `functions/src/wqsEncoder.ts` | Payload binario idéntico al del equipo |
| `scripts/simulador-cip.js` | Orquestador: usa **`functions/lib` compilado** |
| `web/src/lib/controlSimulacion.ts` + `useControlSimulacion` + `ControlSimulacion` | Botón de demo; latido vivo si el contador cambió hace < 15 s **en el reloj del navegador** |

### Receta (tiempo de demo, ~10× más rápido que la planta)

Ciclo por defecto **300 s**:

| Etapa | s | Origen del circuito | Destino retorno | Qué pasa en calidad |
|---|---|---|---|---|
| `preenjuague` | 40 | agua recuperada | drenaje | Residuo de producto (leche): EC cae desde ~1400 hacia 300 µS/cm |
| `alcalino` | 70 | soda (1,8 % NaOH, 78 °C) | drenaje 4 s, luego recirculación | EC y pH suben al frente de soda; sonda **satura** y opera > 60 °C |
| `enjuague` | 40 | agua de red | drenaje | Arrastre rápido de soda + cola lenta hacia EC de red |
| `acido` | 60 | ácido (0,9 %, 64 °C) | drenaje 4 s, luego recirculación | Igual patrón; sonda satura / fuera de operación |
| `enjuague_final` | 60 | agua de red | drenaje 5 s, luego **recuperación** | Arrastre de ácido; en `normal` cruza criterio limpio (200 µS/cm) a mitad de etapa |
| `desinfeccion` | 30 | agua de red + 0,15 % | drenaje | EC ~700, pH ~3,5 |

`--duracion` escala las proporciones (mínimo: ninguna etapa < 6 s, porque el primer uplink va a los 5 s).

Uplinks: cada **10 s**, desfasados **5 s** del inicio de **cada** etapa (`instantesUplink`). Así el primer uplink de un enjuague llega con el arrastre ya evacuado y ninguno cae en el cambio de etapa.

Caudal nominal ~18 m³/h (real); volúmenes chicos porque el tiempo está comprimido. Estanques de demo: soda 1000 L, ácido 800 L, agua recuperada 1000 L. Circuito retiene 150 L. Bomba 2900 rpm, rampa 3 s subida / 2 s bajada.

Temperaturas: ida sigue consigna con τ = 3 s; retorno (donde está el WQS) τ = 6 s más pérdida de calor. El modelo entrega conductividad **real del líquido**; el tope de la DR-ECK1.0 y las marcas `saturado` / `fuera_de_operacion` las pone el backend, no el simulador.

### Escenarios

- **`normal`:** curvas ajustadas para que, con esos instantes de uplink, **ninguna** lectura de etapas monitoreadas cruce umbrales de alerta del seed, y el enjuague final **sí** cruce `criterioLimpio` (200 µS/cm, más exigente que el umbral de alerta 300). En un ciclo real sí habría alertas al inicio de cada enjuague por arrastre; aquí se evitó a propósito para la demo.
- **`falla`:** en enjuague final la EC se estanca ~450 µS/cm (agua de red sucia o válvula de químico con fuga): saltan alertas y no se alcanza limpio.

Sondas simuladas = equipo comprado: DR-PH01 + DR-ECK1.0. DS18B20 desconectado (`tempExterna: null`). Sin turbidez.

Al terminar, el script pone el ciclo en `finalizado` → dispara `alCerrarCiclo`. Ctrl+C (o orden `detener`) lo deja `abortado` (sin indicadores).

### Modos de `sim:cip`

```
npm run sim:cip -- --escenario normal
npm run sim:cip -- --escenario falla --duracion 180
npm run sim:cip -- --esperar          # escucha el botón del dashboard
```

- **Sin `--esperar`:** un ciclo y termina. Default línea `cip-01`, dispositivo `wqs-lb-01` (cuidado: se mezcla con el equipo real si ambos están vivos).
- **`--esperar`:** proceso no termina. Default línea **`cip-sim`**, dispositivo **`wqs-sim-01`**. Latido cada 5 s en `simulacionEstado/{linea}`. Escucha `simulacionControl/{linea}`. El escenario viene **en cada orden**, no en `--escenario`.

Protocolo dashboard → simulador:

1. Admin escribe `simulacionControl/{linea}` (`comando` iniciar/detener, `escenario` normal/falla, `solicitudId`, `solicitadoPor` = uid, `solicitadoEn` = serverTimestamp). Las reglas fijan la forma.
2. `decidir()` ignora orden ya procesada, sin hora confirmada, o vacía; rechaza malformada, vencida (> 60 s), iniciar con otra en marcha, o detener sin simulación.
3. El simulador es el **único que crea ciclos**. Un solo `en_curso` por línea queda en la transacción de `crearCiclo`, no en el botón (el botón solo es comodidad de UI).

No cambiar el modelo “para que se vea más real” sin actualizar tests (`modeloCip.test.ts`, `relojCiclo.test.ts`, `controlSimulacion.test.ts` y copias en `web`). No mandar las lecturas simuladas por `ingestLectura` JSON: el punto de la demo es ejercer decoder + validación física.

## Seguridad (reglas)

- Lecturas: cualquier rol autenticado con claim. Escritura de lecturas: nadie (solo Admin SDK / Functions).
- `collectionGroup('lecturas')` **necesita** el `match /{path=**}/lecturas/{id}` propio. Sin él, histórico entre ciclos da `permission-denied`.
- Operador reconoce alertas: solo campos `reconocida`, `reconocidaPor`, `reconocidaEn`.
- `dispositivos`: lectura solo admin; escritura false.
- `estadoProceso` / `simulacionEstado`: lectura autenticada; escritura false.
- Deuda: un operador hoy puede escribir `recalcular: true` en cualquier ciclo (falta limitar campos).

## Convenciones al cambiar código

1. **Honestidad del dato.** Distinguir medido / estimado / saturado / fuera de operación. No mostrar un estimado como medición.
2. **Funciones puras** (cálculos, validación de alertas, modelo CIP) van testables sin Firestore. Extender tests existentes (`*.test.ts`) antes de inventar harnesses.
3. **No duplicar lógica de negocio en el front.** El front muestra lo que Firestore ya tiene. Excepción: catálogo de sondas (copia forzada + test de paridad).
4. **No desplegar `functions` a secas** ni sin `--only` nominando funciones. En PowerShell el `--only` va **entre comillas** (`--only "functions:a,functions:b"`): sin comillas la coma parte el argumento.
5. **`firestore:rules` reemplaza las reglas completas** del proyecto, no las mezcla.
6. Orden de deploy del dashboard completo: reglas → funciones que cambiaron → Hosting (detalle en `DESPLIEGUE.md`).
7. No commitear secretos: `.env*`, `.secret.local`, `serviceAccount*.json`.
8. UI en español. Nombres de variables/colecciones en camelCase español (`conductividad25C`, `etapaActual`, `ultimaLectura`).
9. No “arreglar” el alcance metiendo etapas químicas en indicadores o inventando caudalímetros.
10. `web/AGENTS.md` lo reescribe Next; no lo uses como spec.
11. La simulación CIP tiene dos canales (PLC vs WQS vía `ttnUplink`). No unificarlos ni saltear el encoder. `cip-sim` no se mezcla con `cip-01`.

## Cómo trabajar en local (resumen)

Detalle en `README.md`. Mínimo:

1. Node 22, Java (emuladores). En Windows, **levantar emuladores desde `cmd.exe`**, no PowerShell (PATH de Java).
2. `functions/.secret.local` con `TTN_WEBHOOK_SECRET=test-secret`.
3. Desde `stormcip/`: `cd functions && npm run build && cd ..` luego `firebase emulators:start --project stormcip-dev`. Si Functions no carga: `FUNCTIONS_DISCOVERY_TIMEOUT=60`.
4. Otra terminal: `cd scripts && npm run seed && npm run sim:ttn` (o `sim:cip` con el secreto en el entorno y el ciclo de seed cerrado).
5. Front: `cd web && npm run dev` con `.env.local` apuntando a emuladores.

## Qué está a medias / no asumir hecho

- Rutas `/monitoreo`, `/historial`, `/configuracion`: shell sin contenido.
- ML / predicción de “minutos hasta limpio”: **no integrado**. El Excel del capstone lo promete; el código no. Si se recorta, la vía defendible es una regresión sobre `pendienteConductividad` ya calculada, no un pipeline Python nuevo.
- Firmware WQS 1.3.x: decoder no soportado.
- Índice `COLLECTION_GROUP` de `lecturas` por `ts DESC` está en `firestore.indexes.json`; confirmar si está desplegado antes de depender de histórico entre ciclos.
- Dashboard de producción hoy es `/dashboard` (admin), no el shell `(panel)`.
