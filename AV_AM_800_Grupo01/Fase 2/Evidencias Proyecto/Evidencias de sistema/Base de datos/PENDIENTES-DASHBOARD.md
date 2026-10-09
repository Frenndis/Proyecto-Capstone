# Pendientes detectados en el dashboard

Revisión de una captura del dashboard en producción (`stormcip-972bd.web.app/dashboard`) y del código de la rama `feature/HL` (commit `41425ad`), 6 de octubre de 2026. Ninguno bloquea la demo, pero conviene resolverlos antes de la presentación.

---

## 1. Posible doble compensación de temperatura en conductividad

**Qué se ve:** la tarjeta "Conductividad a 25 °C (calculado)" muestra 199 µS/cm a partir de 202 µS/cm con la sonda a 25,6 °C.

**Dónde está:** `functions/src/calculos.ts` → `derivarLectura` calcula `conductividad25C = EC / (1 + α·(T−25))` con `T = tempEc` y `α = factorCompensacionEC` (0,02).

**Por qué preocupa:** según el manual de Dragino (sección 4.2.2), la DR-ECK10.0 ya compensa la temperatura internamente (coeficiente 0,02, referencia 25 °C). Si el valor que entrega el payload ya viene compensado, la app lo corrige dos veces. Cerca de 25 °C el error es mínimo; en un enjuague a 50 °C rondaría el 50 %. Además, `criterioLimpio` y los umbrales usan `conductividad25C`, así que el error se propagaría a las alertas y a `tiempoHastaLimpio`.

**Cómo verificar:**
- Preguntar a Dragino si el registro Modbus que reporta el WQS-LB es conductividad compensada o cruda.
- O, con el sensor real, medir la solución patrón de 12,88 mS/cm a una temperatura distinta de 25 °C y ver cuál de los dos valores coincide.

**Mientras tanto:** documentar el supuesto en `modelo-datos-sensores.md`. Si se confirma que la sonda ya compensa, basta con poner `factorCompensacionEC: 0` en `configuracion/calculos` (sin tocar código).

---

## 2. Horas de la alerta inconsistentes (causa confirmada)

**Qué se ve:** una alerta de pH dice "desde 2:33:34 p.m." y "última 2:03:30 p.m.". La última aparición es media hora anterior al inicio.

**Causa:** en `functions/src/ingest.ts` (escritura de alertas con `merge: true`):

```ts
desde: FieldValue.serverTimestamp(), hasta: ts,
```

Hay dos problemas juntos:
- **Dos relojes distintos:** `desde` es la hora del servidor y `hasta` es la hora de la lectura (`ts`). `simulador-prod.js` fecha las lecturas hacia atrás, por eso la diferencia salta a la vista.
- **`desde` se sobrescribe en cada repetición:** con `merge: true`, cada lectura fuera de rango vuelve a escribir `desde`, así que deja de ser "desde cuándo" y pasa a ser "la última vez que el servidor la tocó".

**Acción:** que `desde` y `hasta` salgan del mismo reloj (`ts` de la lectura) y que `desde` se escriba solo cuando la alerta se crea (por ejemplo, leyendo el documento antes del batch o con una transacción). Agregar un test en `ingest.test.ts` que procese dos lecturas fuera de rango y verifique que `desde` no cambia. Opcional: guardar la hora del servidor en un campo aparte (`actualizadaEn`).

---

## 3. Formato del umbral con un solo límite (causa confirmada)

**Qué se ve:** "Objetivo —–3000" en conductividad y "Objetivo —–60" en turbidez.

**Causa:** en `web/src/components/TarjetaVariable.tsx`:

```ts
`Objetivo ${rango.min ?? "—"}${rango.max !== undefined ? `–${rango.max}` : " o más"}`
```

Si `min` no existe, imprime "—" y luego "–3000".

**Acción:** formatear según los límites presentes, idealmente con una función pura en `lib/tipos.ts` con su test:
- solo máximo → `≤ 3000`
- solo mínimo → `≥ 5`
- ambos → `5–11`
- ninguno → `Sin umbral definido` (como ya se hace)

---

## 4. Ingest no valida `tempMaxOperacion`

**Qué pasa:** `validarYLimpiarValores` (`functions/src/ingest.ts`) solo compara cada valor con el `min`/`max` de su sonda en `CATALOGO_SONDAS` (`functions/src/types.ts`). El campo `tempMaxOperacion` está declarado (por ejemplo, 60 °C para la `DR-PH01` y la `DR-ECK10.0`, 40 °C para la `DR-TS1`) pero nadie lo revisa.

**Consecuencia:** en las etapas químicas (alcalino a ~76 °C en el retorno, ácido a ~62 °C) se descartan la conductividad (supera 20 000 µS/cm) y las temperaturas de sonda (superan 60 °C), pero el **pH y la turbidez se guardan** como si fueran confiables, aunque la sonda esté trabajando sobre su temperatura máxima de operación. Se aceptó así para el simulador de la demo (`scripts/simulador-cip.js`); el dashboard ya muestra el aviso de "etapa fuera del alcance de monitoreo".

**Propuesta futura:** en vez de descartar el valor, guardarlo con confianza `"fuera_de_operacion"` cuando la temperatura medida en la misma lectura supera la `tempMaxOperacion` de la sonda. Así queda el dato para auditoría, pero no se usa en derivados, umbrales ni indicadores, y el dashboard puede mostrarlo atenuado.

> ✅ **Resuelto en el backend** (9 de octubre de 2026): `validarYLimpiarValores` marca `"fuera_de_operacion"` y, sobre el máximo físico, guarda el tope con `"saturado"` en vez de descartar (ver `modelo-datos-sensores.md`, sección 2.3). Falta mostrarlo en el dashboard (punto 10).

---

## 5. Firmware real del nodo y formato 1.3.x

**Qué falta:** confirmar la versión de firmware del WQS-LB comprado con el uplink de estado (FPort 5) o con `AT+VER`. El decoder solo entiende firmware 1.2.x (flag de 1 byte, formato B); con firmware ≥ 1.3.1 el flag pasa a 2 bytes, el mapa de bits no está documentado y **todas las lecturas se rechazan**.

**Estado:** consulta enviada a Dragino por el formato 1.3.x. Hasta tener respuesta, registrar en `dispositivos/{id}.firmware` la versión real (no suponer "1.2").

---

## 6. Modo del gateway Milesight UG65

**Qué falta:** definir si el UG65 trabaja como **reenviador de paquetes** hacia The Things Stack (lo que asume `ttnUplink`: webhook con `frm_payload` y `received_at` en formato TTS) o como **servidor de red propio** (embedded network server). En el segundo caso el formato del webhook cambia y habría que adaptar el adaptador o agregar otro.

---

## 7. Flujómetro SW3L-LB

**Qué falta:** el manual del SW3L-LB-006-AU915 (formato de payload, unidades, intervalo) y verificar que su **rango de caudal y de temperatura** sirva para un CIP (caudales de ~18 m³/h y soluciones a 75–80 °C en el alcalino). Hoy el sistema no lo decodifica: el volumen sigue siendo una estimación con el caudal nominal (`volumenEstimado`, confianza `"estimado"`).

---

## 8. Ubicación de las sondas y calibración

**Qué falta:**
- **Ubicación física:** la `DR-PH01` y la `DR-ECK1.0` operan hasta **60 °C**. En el retorno del alcalino el líquido llega a ~76 °C y en el ácido a ~62 °C: si las sondas quedan en la línea durante esas etapas, trabajan fuera de su rango de operación (el backend lo marca como `"fuera_de_operacion"`, pero la sonda se puede dañar). Definir con el cliente dónde se instalan (derivación, celda de flujo con válvula, solo en enjuagues).
- **Soluciones de calibración disponibles localmente:** pH 4,01 / 6,86 / 9,18 y conductividad 1413 µS/cm (dentro del rango de la `DR-ECK1.0`). Confirmar proveedor y procedimiento, y registrar la fecha en `sondas.{id}.ultimaCalibracion`.

---

## 9. Reglas: el operador puede escribir campos del backend en `ciclos`

**Qué pasa:** `firestore.rules` permite al operador actualizar **cualquier** campo de `ciclos/{id}`, incluidos los que solo escribe el backend: `ultimaLectura`, `variablesVistas` e `indicadores*` (y `lecturasConsideradas`, `recalcular`).

**Acción (cuando se definan los permisos del operador):** limitar su `update` con `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])` a los campos que le correspondan, por ejemplo `etapaActual`, `estado`, `fin` y `consumos`. No se cambió todavía.

---

## 10. Tarjetas del dashboard según las sondas del equipo (propuesta, sin implementar)

**Qué asume hoy el dashboard:** `web/src/app/dashboard/page.tsx` muestra una lista fija de variables (`VISIBLES`, que incluye `turbidez` y `tempExterna`) y del selector de tendencia (`GRAFICABLES`, con `turbidez`), y el aviso de etapa química menciona "turbidez hasta 40 °C". Con el equipo comprado esas tarjetas quedan siempre en "—".

**Propuesta:**
- **Qué tarjetas mostrar:** las de `ciclos/{id}.variablesVistas.{deviceId}` (ya lo escribe el backend). Solo crece durante el ciclo, así que una variable descartada en una lectura no desaparece de la pantalla; no requiere leer `dispositivos` (solo admin); y una sonda nueva aparece sola.
- **Estado de cada tarjeta**, desde `ultimaLectura.{deviceId}` (`confianza` y `descartadas` ya se guardan): valor normal; **"≥ 2000"** si está saturada; **atenuada** con "fuera de operación"; o **"Sin dato: <motivo>"** si la última lectura la descartó.
- **Alertas:** las de `tipo: "saturacion"` mostrarlas como "≥ {max}" en `PanelAlertas` / `HistorialAlertas` (hoy `formatearRango` las mostraría como "≤ {max}").
- Quitar la mención fija a la turbidez del aviso de etapa química, o mostrarla solo si el equipo la mide.

