# Lo comprado y lo construido — StormCIP

**Habilitador:** HT-05 (Documentación técnica y de usuario).
**Criterio de aceptación:** documentos al día con lo comprado y lo construido; manual de usuario entregado.
**Actualizado al:** 23-11-2026 · commit `44205a9`.

Este documento es el inventario del proyecto: qué equipos se compraron, qué software existe hoy y dónde está documentado cada cosa.

## 1. Lo comprado

Fuente: los tres documentos de [`Evidencias de sistema/Gestion Sensores/`](../../Evidencias%20de%20sistema/Gestion%20Sensores). Los montos coinciden entre cotización, orden de compra y factura.

| Documento | Número | Fecha | Emisor |
|---|---|---|---|
| Cotización | COT-2026-1917 | 07-10-2026 (válida hasta el 22-10) | Altronics Chile SpA |
| Orden de compra | P01311 | 07-10-2026 | Austral Chemicals Chile SpA |
| Factura electrónica | N° 27500 | 09-10-2026 | Altronics Chile SpA |

| Equipo | Modelo | Cant. | Precio neto (CLP) | Para qué se usa | Foto de recepción |
|---|---|---|---|---|---|
| Nodo LoRaWAN de calidad de agua | Dragino WQS-LB-AU915 | 1 | 67.890 | Lee las sondas y envía las lecturas por LoRaWAN | `s01_lorawan_calidad_agua.jpeg` |
| Sensor de pH | DR-PH01 | 1 | 178.800 | pH del retorno en los enjuagues | `s02_sensor_pH.jpeg` |
| Sensor de conductividad | DR-ECK1.0 | 1 | 149.890 | Conductividad del retorno: criterio de agua limpia y concentración química | `s05_sensor_conductividad.jpeg` |
| Flujómetro LoRaWAN 3/4" DN20 | Dragino SW3L-LB-006-AU915 | 1 | 67.134 | Caudal: volumen de agua por etapa | `s04_lorawan_flujometro.jpeg` |
| Gateway LoRaWAN | Milesight UG65-L08GL-915M-EA | 1 | 386.436 | Recibe a los nodos y reenvía a The Things Stack | `s03_gateway_lorawan.jpeg` |
| Envío (Región Metropolitana) | — | 1 | 4.513 | — | — |
| **Neto** | | | **854.663** | | |
| IVA 19 % | | | 162.386 | | |
| **Total** | | | **1.017.049** | | |

**Servicios en la nube.** El proyecto usa Firebase (Google Cloud) en el plan Blaze, de pago por uso, en el proyecto `stormcip-austral`. No hay una factura de nube en el repositorio: el costo acumulado **está por confirmar** en la consola de facturación.

**Estado de uso de lo comprado.** Según el plan del proyecto al 02-11-2026, los equipos se recibieron (19-10) y la maqueta estaba en armado, con las sondas sin instalar. **El estado al 23-11 está por confirmar con el técnico de hardware.** El software está listo para recibirlos:

| Equipo | Soporte en el software | Qué falta |
|---|---|---|
| WQS-LB + DR-PH01 + DR-ECK1.0 | Decoder propio por versión de firmware (`wqsDecoder.ts`), validación de rango físico y saturación, webhook `ttnUplink` | Registrar el equipo en The Things Stack y en `dispositivos/{id}`; primer uplink real |
| SW3L-LB-006 (flujómetro) | El volumen por etapa se calcula desde el caudal de `estadoProceso` (`volumenCirculado.ts`) | No hay decoder del SW3L-LB: hoy el caudal llega del simulador. Manual del equipo pendiente de revisar |
| Gateway UG65 | No requiere software propio | Configurarlo contra The Things Stack (AU915) |

Información técnica de los sensores: [`Informacion Tecnica Sensores/WQS-LB/`](../../Evidencias%20de%20sistema/Informacion%20Tecnica%20Sensores/WQS-LB) (manual, datasheet, firmware y certificaciones).

## 2. Lo construido

### 2.1 Aplicación web

Next.js 16 con exportación estática, publicada en Firebase Hosting: https://stormcip-austral.web.app. Código en `Aplicación/stormcip/web/`.

| Pantalla | Ruta | Qué hace | Rol mínimo |
|---|---|---|---|
| Portada e inicio de sesión | `/`, `/login` | Presentación y acceso con correo y contraseña | — |
| Central CIP | `/central` | Ciclos de hoy, plano de circuitos y estado de cada uno | Visor |
| Ciclo en vivo | `/dashboard` | Fases, gráfico por variables y periodo, proyección con confianza, avisos de tendencia, validación TACT | Visor (iniciar ciclo: operador) |
| Registros de ciclo | `/registros` | Registro imprimible de cada ciclo cerrado y liberación del circuito | Visor |
| Consumos | `/consumos` | Agua y químico por día y por circuito, posibles fugas | Visor |
| Predicción y ahorro | `/prediccion` | Decisiones recomendadas y desempeño de los modelos | Visor (decidir: admin) |
| Reportes | `/reportes` | Resumen para gerencia y evidencia de auditoría | Visor |
| Sensores WQS-LB | `/sensores` | Lecturas de la línea piloto y control de su simulador | Visor |
| Planes de limpieza | `/configuracion` | Planes (circuito y receta) y límites de validación | Visor (editar: admin) |
| Usuarios | `/usuarios` | Alta, roles, activación y restablecimiento de contraseña | Admin |

### 2.2 Backend: 17 Cloud Functions

Código en `Aplicación/stormcip/functions/src/`. Todas están desplegadas en `stormcip-austral`.

| Función | Tipo | Región | Qué hace |
|---|---|---|---|
| `ttnUplink` | HTTP | `southamerica-west1` | Webhook de The Things Stack: decodifica, valida y guarda la lectura. Idempotente |
| `ingestLectura` | HTTP | `southamerica-west1` | Endpoint para simuladores y gateways que envían lecturas ya decodificadas |
| `alCrearLectura` | Firestore | `southamerica-west1` | Recalcula la proyección del fin del enjuague con cada lectura |
| `alCerrarCiclo` | Firestore | `southamerica-west1` | Calcula los indicadores al cerrar un ciclo |
| `recalcularIndicadores` | Callable (admin) | `southamerica-west1` | Recálculo manual de indicadores |
| `alCambiarEstadoProceso` | Firestore | `southamerica-west1` | Integra el caudal y acumula el volumen por etapa |
| `iniciarCicloDemo` | Callable (operador) | `southamerica-west1` | Corre un ciclo de demostración a 20× con el plan elegido |
| `recalcularDecisiones` | Firestore | `southamerica-west1` | Al cerrar un ciclo, reentrena los modelos y actualiza las decisiones |
| `planificarCiclos` | Programada, cada hora | `southamerica-east1` | Agrega los ciclos programados de los planes activos |
| `asegurarPlanes` | Callable | `southamerica-west1` | Deja en Firestore los 8 planes de fábrica si aún no existen |
| `guardarPlan` | Callable (admin) | `southamerica-west1` | Valida y guarda un plan nuevo o modificado |
| `eliminarPlan` | Callable (admin) | `southamerica-west1` | Elimina un plan sin ciclo en curso |
| `onUserCreated` | Auth (1ª gen.) | `southamerica-east1` | Asigna el rol a una cuenta nueva: el previsto, o visor |
| `setUserRole` | Callable (admin) | `southamerica-west1` | Cambia un rol; protege al último administrador |
| `listarUsuarios` | Callable (admin) | `southamerica-west1` | Lista las cuentas con su rol y estado |
| `crearUsuario` | Callable (admin) | `southamerica-west1` | Crea una cuenta con su rol |
| `setUserActivo` | Callable (admin) | `southamerica-west1` | Activa o desactiva una cuenta y cierra sus sesiones |

### 2.3 Datos en Firestore

| Colección o documento | Contenido |
|---|---|
| `ciclos/{id}` | Ciclos. Los de la planta de demostración (`v: 3`) guardan fases, curva, resumen y predicción |
| `ciclos/{id}/lecturas/{id}` | Lecturas de sensores (línea piloto) |
| `alertas/{id}` | Alertas por umbral de las lecturas de sensores |
| `dispositivos/{id}` | Equipos registrados, sondas y firmware |
| `estadoProceso/{lineaId}` | Estado en vivo de una línea (simulador o PLC) |
| `users/{uid}` | Correo, nombre y rol de cada cuenta |
| `configuracion/planes` | Planes de limpieza editables |
| `configuracion/calculos` | Límites: agua limpia, agua de red, meta diaria |
| `configuracion/oportunidades`, `configuracion/decisiones` | Decisiones recomendadas, métricas de los modelos y lo que se aprobó |
| `configuracion/umbrales` | Umbrales de alerta por etapa (línea piloto) |

Reglas de seguridad por rol en `firestore.rules`, con 20 pruebas. Modelo de datos de sensores: [`Base de datos/modelo-datos-sensores.md`](../../Evidencias%20de%20sistema/Base%20de%20datos/modelo-datos-sensores.md).

### 2.4 Análisis predictivo

| Componente | Dónde | Estado |
|---|---|---|
| Proyección del fin del enjuague (regresión sobre la caída de conductividad) | `functions/src/proyeccionEnjuague.ts` | En producción |
| Modelos Random Forest: tiempo hasta agua limpia, agua, químico y riesgo de desvío | `functions/src/planta/ml.ts` | En producción, **entrenados con ciclos simulados** |
| Decisiones de ahorro y posibles fugas | `functions/src/planta/decisiones.ts` | En producción |
| Proyección en minutos con confianza y avisos de tendencia | `web/src/lib/tendencia.ts` | En producción desde el 23-11 |

Falta validarlos con datos reales de la maqueta (HU-07).

### 2.5 Scripts

En `Aplicación/stormcip/scripts/`. Ninguno toca producción sin `--prod --project stormcip-austral`.

| Script | Uso |
|---|---|
| `seed.js`, `sembrar-planta.js` | Datos de prueba y 120 días de ciclos simulados |
| `simulador.js`, `simulador-ttn.js`, `simulador-cip.js` | Simuladores de lecturas, del webhook y de un ciclo CIP completo |
| `e2e-volumen.js`, `e2e-quimica.js` | Pruebas de punta a punta |
| `carga-ingesta.js` | Prueba de carga de la ingesta (nuevo, 23-11) |
| `uat-recorrido.js` | Recorrido de aceptación automatizado con capturas (nuevo, 23-11) |
| `cerrar-ciclo.js`, `recalcular.js`, `rotar-key.js`, `seed-prod.js`, `produccion-plantilla.js`, `revisar-config-prod.js`, `verificar-build-web.js` | Mantenimiento y despliegue |

## 3. Mapa de la documentación

| Documento | Ubicación | Al día al |
|---|---|---|
| README del repositorio | `README.md` (raíz) | 23-11-2026 |
| Manual de usuario | [`Manual de usuario/manual-de-usuario.md`](../Manual%20de%20usuario/manual-de-usuario.md) | 23-11-2026 |
| Plan de pruebas y evidencia | [`Plan de pruebas/plan-de-pruebas.md`](../Plan%20de%20pruebas/plan-de-pruebas.md) | 23-11-2026 |
| Acta UAT | [`Plan de pruebas/acta-uat.md`](../Plan%20de%20pruebas/acta-uat.md) | 23-11-2026, pendiente de firma |
| Lo comprado y lo construido | Este documento | 23-11-2026 |
| Plan del proyecto (backlog, historias, riesgos) | `Plan del proyecto/Plan_Proyecto_MVP_CIP.xlsx` | 23-11-2026 (filas de HU-04, HU-07, HU-09, HT-04 y HT-05) |
| Diagrama de arquitectura | `Diagrama de arquitectura/` | 02-11-2026 |
| Diagramas UML | `Diagramas UML/diagramas-uml.md` | 26-10-2026 |
| Guía de despliegue | `Aplicación/stormcip/DESPLIEGUE.md` | 23-11-2026 (tabla de funciones) |
| Pruebas locales con emuladores | `Aplicación/stormcip/README.md` | Octubre 2026 |
| Modelo de datos de sensores | `Base de datos/modelo-datos-sensores.md` | Octubre 2026 |
| Explicación del sistema de sensores | `Evidencias de sistema/EXPLICACION-SISTEMA-SENSORES.md` | Septiembre 2026 |
| Cierres de sprint | `Aplicación/stormcip/SPRINT1.md`, `SPRINT3.md` | Solo sprints 1 y 3 |

### Lo que sigue desactualizado

- **Diagramas UML y de arquitectura:** no incluyen la gestión de usuarios, los planes de limpieza ni la planta de demostración.
- **`SPRINT1.md` y `SPRINT3.md`:** nombran el proyecto anterior (`stormcip-972bd`). El vigente es `stormcip-austral`. No hay documento de cierre de los sprints 2, 4, 5 y 6.
- **Plan del proyecto:** varias observaciones del backlog aún citan `stormcip-972bd`.
- **`PENDIENTES-DASHBOARD.md`:** describe el dashboard anterior al rediseño de noviembre.
