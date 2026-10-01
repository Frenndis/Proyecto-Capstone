# Sprint 3 · Backend / Dashboard — StormCIP

**Objetivo:** cerrar el ciclo completo del dato: que una lectura que entra por el
gateway LoRaWAN termine siendo un indicador visible en el dashboard.

**Cierre:** 04-10-2026 · **Responsable:** Cristian Quilaleo
**URL en producción:** https://stormcip-972bd.web.app

---

## 1. Entregado

| Fila | Tarea | Quién | Estado |
|---|---|---|---|
| 16 | Cloud Function de ingesta del gateway (`ttnUplink`) | **Humberto** | Desplegada |
| 17 | Esqueleto de dashboard con datos en tiempo real | Cristian | Desplegado |

> La fila 16 figuraba asignada a Tamara en el backlog. La implementó Humberto.
> Corregir la asignación en el Excel para que el avance quede atribuido a quien
> lo hizo.

### Trigger de cierre de ciclo

`alCerrarCiclo` (`functions/src/ciclos.ts`) invoca `derivarCiclo()` cuando un
ciclo pasa a `finalizado`, o cuando se le escribe `recalcular: true` para
mantenimiento. Escribe en el documento del ciclo:

| Campo | Contenido |
|---|---|
| `indicadores` | valores globales del ciclo |
| `indicadoresMetodo` | la fórmula usada en cada uno |
| `indicadoresConfianza` | `medido` o `estimado` |
| `indicadoresPorEtapa` | lo mismo, desglosado por etapa |
| `lecturasConsideradas` | cuántas lecturas entraron al cálculo |
| `indicadoresCalculadosEn` | marca de tiempo del cálculo |

Indicadores: `tiempoHastaLimpio` (s), `arrastreQuimico` (µS/cm),
`pendienteConductividad` (µS/cm/min), `volumenEstimado` (m³).

**Alcance deliberado:** solo las etapas monitoreadas (preenjuague, enjuague,
enjuague final). En las etapas químicas las sondas WQS trabajan fuera de su rango
físico (pH y EC hasta 60 °C, turbidez hasta 40 °C), así que incluirlas
ensuciaría la curva de conductividad con datos no comparables.

**Volumen global = suma del volumen por etapa**, no el cálculo sobre el lapso
completo: entre el preenjuague y el enjuague final hay etapas químicas donde no
corre agua de enjuague, y tomar el lapso entero inflaría el número. Si no hay
volumen por etapa, el indicador no se informa en vez de informar un número malo.

### Dashboard

`useCicloMostrado()` muestra el ciclo en curso y, si no hay ninguno, el último
finalizado.

> **Por qué hacía falta ese fallback:** la sección de indicadores ya existía pero
> nunca podía mostrar datos. El dashboard solo consultaba ciclos `en_curso`, y el
> trigger escribe los indicadores al pasar a `finalizado` — justo cuando el ciclo
> desaparecía de la pantalla. Los datos estaban en Firestore y la única vista que
> los leía quedaba oculta.

Se filtra a `finalizado` y no a `abortado`: un ciclo abortado no dispara el
trigger, así que no tiene indicadores y mostrarlo sería una pantalla vacía sin
explicación.

### Trazabilidad del dato mostrado

Requisito de honestidad del MVP: **un indicador estimado no puede verse igual que
uno medido.** `volumenEstimado` sale del caudal nominal de la bomba, no de un
caudalímetro — en la planta no hay uno.

Se marca con tres señales redundantes, no solo color: borde punteado, color
ámbar y prefijo `≈`. El color por sí solo no sobrevive a una captura en blanco y
negro ni al daltonismo. El `indicadoresMetodo` va visible bajo cada valor y no en
un tooltip: "caudal nominal supuesto" es justo lo que no debe esconderse.

La sección distingue cuatro estados en vez de "hay datos / no hay datos", porque
un espacio en blanco no diferencia un ciclo todavía abierto de uno que cerró sin
datos usables:

| Estado | Qué significa |
|---|---|
| `pendiente` | el trigger no ha corrido (ciclo en curso) |
| `sin_lecturas` | corrió, pero ninguna lectura cayó en etapa monitoreada |
| `sin_valores` | hubo lecturas, pero ninguna con conductividad válida |
| `listo` | hay indicadores que mostrar |

### Seguridad

Regla de grupo de colección en `firestore.rules`. Una consulta
`collectionGroup('lecturas')` **no** se evalúa con la regla anidada de
`/ciclos/{id}/lecturas/{id}`: necesita su propio `match` sobre
`/{path=**}/lecturas/{id}`. Sin ella la consulta falla con `permission-denied`
aunque el usuario pueda leer cada ciclo por separado. Destraba el histórico entre
ciclos del Sprint 5.

---

## 2. Verificación

Comprobado de primera mano, no por inspección de código:

- **Tests:** 30 en `functions` (`npm test`), 10 en `web`. Build y type-check de
  Next limpios.
- **Functions desplegadas** (`firebase functions:list`): `alCerrarCiclo` (v2,
  trigger `document.updated`, `southamerica-west1`), `recalcularIndicadores`
  (callable), `ingestLectura`, `ttnUplink`, `setUserRole` — todas en
  `southamerica-west1`; `onUserCreated` en `southamerica-east1` (1ª gen no corre
  en west1).
- **Índices desplegados** (`firebase firestore:indexes`): está el compuesto
  `ciclos: estado ASC + inicio DESC` que usa la consulta del dashboard.
- **Hosting:** desplegado y verificado contra el chunk servido por la URL
  pública, no solo contra el mensaje "Deploy complete".

### Evidencia pendiente de adjuntar

Captura del dashboard con los indicadores visibles, tomada con sesión real. No se
pudo generar automáticamente: requiere login en producción.

---

## 3. No entregado, y se declara así

**Fila 18 — "Integrar el modelo ML entrenado al backend"** (4 días).

Depende de la fila 13 (entrenar el primer modelo, Sprint 2), que tampoco está.
No se resuelve dentro de este sprint. Lo correcto en Scrum es declararla no
completada en el review y moverla, no marcarla como hecha.

### Para el sprint review: el problema de fondo

Sumando las filas con nombre "Cristian", las compartidas con Humberto y todas las
de "Dev Backend", el Excel asigna **55 días-persona pendientes a una sola
persona**. Hasta la demo del 04-12 hay ~45 días hábiles. Descontando las tareas
ya hechas que el Excel no registra, quedan **49 sobre 45**. No cabe.

De esos 49, **22 son de Análisis Predictivo** (diseñar la simulación, generar el
dataset, entrenar, integrar, recalibrar, validar): una línea completa, con 3
sprints de atraso, asignada a un rol sin nombre.

La hoja de Riesgos del propio Excel ya previó esto: priorizar el ML sobre pulido
de UI secundario o históricos extendidos, *nunca* sobre el pipeline de datos en
tiempo real, y evaluar en el review del Sprint 4 si hay que recortar.

Dos salidas a plantear:

1. **Repartir** — el dataset simulado (fila 12) es Python puro y no depende del
   backend. Tamara o Felipe lo pueden tomar.
2. **Recortar a lo defendible** — una regresión lineal sobre
   `pendienteConductividad` para proyectar en qué minuto el agua llega al
   criterio de limpio. Usa datos que el trigger ya calcula, corre en Node sin
   Python ni Cloud Run, y cumple lo que el Excel promete mostrar en la demo ("al
   ritmo actual, esto pasa en N minutos"). Un par de días en vez de 22.

---

## 4. Deuda conocida

| Tema | Detalle |
|---|---|
| Índice de histórico | El `COLLECTION_GROUP` de `lecturas` por `ts DESC` está restaurado en `firestore.indexes.json` pero **no desplegado**. El histórico de Sprint 5 no funcionará hasta correr `firebase deploy --only firestore:indexes`. Los índices de un solo campo se crean solos únicamente en scope `COLLECTION`. |
| Lint del front | `npm run lint` arroja 11 errores preexistentes (`no-explicit-any` en tipos de Timestamp de Firestore, y un `set-state-in-effect` en `useLecturas`). No bloquean el build. |
| Permisos de `operador` | Hoy un `operador` puede escribir `recalcular: true` en cualquier ciclo. Falta una regla que limite qué campos puede tocar. |
| Vulnerabilidades npm | 13 reportadas en Functions. Revisar sin `--force` a ciegas. |
| PDFs en el repo | Las certificaciones de sensores hacen que el fetch baje ~80 MB. Mover a Drive. |

### Alcance que el plan todavía promete y el código ya no asume

El alcance real es **monitoreo de enjuagues**, no de etapas químicas. El código ya
lo asume; el plan todavía habla de "consumo de químicos" y de un caudalímetro que
no existe. Conviene dejarlo por escrito antes de la demo.

Los 4 parámetros de `configuracion/calculos` son supuestos razonados, no
mediciones, y deberían documentarse como tales: conductividad del agua de red,
caudal nominal, duración de etapas y criterio de agua limpia.

---

## Definition of Done

- [x] El trigger calcula indicadores al cerrar un ciclo y al pedir recálculo
- [x] Los indicadores quedan en Firestore con método y nivel de confianza
- [x] El dashboard los muestra y distingue `medido` de `estimado`
- [x] Un ciclo sin lecturas útiles explica por qué, en vez de quedar en blanco
- [x] La consulta de grupo de colección tiene regla propia
- [x] Tests en backend y frontend; build y type-check limpios
- [x] Desplegado y verificado en la URL pública
- [ ] Captura del dashboard con datos reales adjunta a la evidencia
- [ ] Pull Request `CR` → `main` revisado y mergeado
- [ ] Excel actualizado (filas 6, 10, 11, 16, 17 y la observación de la fila 5)
