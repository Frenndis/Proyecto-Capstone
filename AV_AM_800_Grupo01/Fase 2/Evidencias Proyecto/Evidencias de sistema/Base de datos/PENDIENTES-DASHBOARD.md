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

