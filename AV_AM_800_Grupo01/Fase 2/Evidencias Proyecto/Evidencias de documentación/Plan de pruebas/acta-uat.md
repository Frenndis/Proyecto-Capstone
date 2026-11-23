# Acta de pruebas de aceptación (UAT) — StormCIP

| | |
|---|---|
| **Versión probada** | Commit `44205a9` (rama `main`), la misma desplegada en https://stormcip-austral.web.app el 23-11-2026 |
| **Fecha de ejecución** | 23-11-2026, 14:34 (Sprint 7) |
| **Ejecutada por** | QA del equipo (Felipe Carreño), con el recorrido automatizado `scripts/uat-recorrido.js` |
| **Ambiente** | Web local contra los emuladores de Firebase (`stormcip-dev`), con `seed.js` y `sembrar-planta.js` |
| **Datos** | Simulados: planta de demostración de 8 circuitos y 882 ciclos. Sin maqueta ni sensores reales |
| **Resultado** | **38 de 38 casos pasan** |
| **Estado del acta** | **Ejecutada. Pendiente de aprobación** del dueño del producto o del cliente (sección 4) |

## 1. Qué se aceptó y qué no

Los casos salen de los criterios de aceptación de las historias de usuario del plan del proyecto (hoja «Historias de usuario»). Cada caso se comprobó en pantalla con uno de los tres roles: administrador, operador y visor.

**Quedan fuera de esta UAT**, porque dependen de la maqueta (HT-03):

- HU-12: lecturas reales del WQS-LB llegando por The Things Stack.
- HU-10: estado real del equipo (firmware, batería y última señal) a partir de un uplink FPort 5 verdadero.
- HU-05: consumo de agua medido por el flujómetro; hoy el consumo es simulado.
- HU-07: utilidad de los modelos con datos reales; hoy se entrenan con ciclos simulados.

El plan original pedía la UAT «con datos reales de la maqueta». Esta ejecución **no cumple esa parte**: valida la aplicación completa con datos simulados. Cuando la maqueta esté operativa hay que repetir los casos de HU-01, HU-05, HU-10 y HU-12.

## 2. Casos ejecutados

| Caso | Historia | Criterio comprobado | Resultado | Observación y evidencia |
|---|---|---|---|---|
| UAT-01 | HU-08 | sin sesión, /dashboard lleva al inicio de sesión | Pasa |  [captura](evidencia/capturas/01-inicio-de-sesion.png) |
| UAT-02 | HU-08 | contraseña incorrecta muestra un error y no entra | Pasa | mensaje: «No se pudo iniciar sesión. Revisa tu conexión e intenta de nuevo.» |
| UAT-03 | HU-08 | el administrador inicia sesión y llega a Central CIP | Pasa |  |
| UAT-04 | | Central CIP muestra los ciclos de hoy y el plano de circuitos | Pasa |  [captura](evidencia/capturas/02-central-cip.png) |
| UAT-05 | HU-04 | el gráfico ofrece elegir variables (6) y periodo (5) | Pasa |  |
| UAT-06 | HU-04 | al agregar Conductividad aparece su carril en el gráfico | Pasa | 4 carriles |
| UAT-07 | HU-04 | con «Últimos 7 días» se dibujan las lecturas de todos los ciclos del periodo | Pasa | 7 ciclos · 637 lecturas |
| UAT-08 | HU-04 | al pasar el cursor se ve ciclo, fase y valor de cada variable | Pasa |  [captura](evidencia/capturas/04-grafico-por-periodo.png) |
| UAT-09 | HU-04 | «Últimos 30 días» con todos los circuitos carga más de 100 ciclos | Pasa | 216 ciclos · 19.656 lecturas |
| UAT-10 | HU-11 | un operador o admin inicia un ciclo de demostración desde el dashboard | Pasa |  |
| UAT-11 | HU-07 | el dashboard muestra una proyección en minutos con su nivel de confianza | Pasa | ≈ 24 min · confianza 98 % · alta |
| UAT-12 | HU-02 | la barra de fases marca la fase en curso y el reloj avanza | Pasa |  |
| UAT-13 | HU-07 | se avisa cuando una variable tiende a salir de su rango, con su confianza | Pasa | 07:15 Temperatura tiende a bajar del mínimo (65,0 °C) en menos de 1 min · confianza 83 % |
| UAT-14 | HU-03 | al salir del rango queda el aviso «fuera de rango» con valor y límite | Pasa |  [captura](evidencia/capturas/03-ciclo-en-vivo.png) |
| UAT-15 | HU-07 | en el enjuague final se proyecta en minutos cuándo llega a agua limpia | Pasa | Agua limpia · enjuague final ≈ 1,0 min confianza 87 % · alta Quedarían 00:59 de fase con el agua ya limpia. El [captura](evidencia/capturas/03b-proyeccion-agua-limpia.png) |
| UAT-16 | HU-06 | al cerrar, el ciclo queda «Con desvío» y emite su registro | Pasa |  |
| UAT-17 | HU-06 | el registro del ciclo muestra cumplimiento por fase, agua limpia y consumos | Pasa |  [captura](evidencia/capturas/05-registros-de-ciclo.png) |
| UAT-18 | HU-05 | Consumos muestra agua y químico de los últimos 30 días y por circuito | Pasa |  [captura](evidencia/capturas/06-consumos.png) |
| UAT-19 | HU-07 | Predicción lista decisiones con ahorro y el desempeño de los modelos | Pasa |  [captura](evidencia/capturas/07-prediccion-y-ahorro.png) |
| UAT-20 | | Reportes entrega el resumen para gerencia de los últimos 30 días | Pasa |  [captura](evidencia/capturas/08-reportes.png) |
| UAT-21 | HU-01/HU-10 | Sensores WQS-LB abre la vista de la línea piloto | Pasa |  [captura](evidencia/capturas/09-sensores.png) |
| UAT-22 | Planes | se listan los 8 planes de fábrica y los límites de validación | Pasa |  [captura](evidencia/capturas/10-planes-de-limpieza.png) |
| UAT-23 | Planes | el servidor rechaza un plan inválido (mínimo sobre el objetivo) y explica por qué | Pasa |  [captura](evidencia/capturas/11-nuevo-plan.png) |
| UAT-24 | Planes | el administrador crea un plan nuevo y aparece en la lista | Pasa |  |
| UAT-25 | Planes | el administrador modifica un plan y el cambio queda guardado (25 → 28 min) | Pasa |  |
| UAT-26 | Límites | no se acepta un criterio de agua limpia menor que el agua de red | Pasa |  |
| UAT-27 | HU-09 | el administrador crea cuentas con su rol (operador y visor) | Pasa | 3 cuentas [captura](evidencia/capturas/12-usuarios.png) |
| UAT-28 | HU-09 | el administrador cambia el rol de un usuario | Pasa |  |
| UAT-29 | HU-09 | no se puede dejar la planta sin administrador (único admin) | Pasa |  |
| UAT-30 | Usuarios | el administrador desactiva y reactiva una cuenta | Pasa |  |
| UAT-31 | HU-08 | el visor inicia sesión | Pasa |  |
| UAT-32 | HU-08 | el visor no ve el menú Usuarios | Pasa |  |
| UAT-33 | HU-08 | el visor ve el ciclo pero no puede iniciar uno | Pasa |  |
| UAT-34 | HU-08 | el visor no entra a Usuarios: ve «Sin permisos» | Pasa |  [captura](evidencia/capturas/13-sin-permisos.png) |
| UAT-35 | HU-08 | el visor ve los planes pero sin botones para crear ni modificar | Pasa |  |
| UAT-36 | HU-08 | el operador inicia sesión | Pasa |  |
| UAT-37 | HU-08 | el operador puede iniciar un ciclo, y no ve Usuarios | Pasa |  |
| UAT-38 | HU-08 | el operador no puede crear ni modificar planes | Pasa |  |

El registro completo de la corrida está en [`evidencia/uat-recorrido.log`](evidencia/uat-recorrido.log) y las 14 capturas en [`evidencia/capturas/`](evidencia/capturas).

## 3. Observaciones de la ejecución

| ID | Observación | Severidad | Acción propuesta |
|---|---|---|---|
| H-03 | UAT-02 pasa (no deja entrar y muestra un error), pero en el emulador el texto dice «Revisa tu conexión» en vez de «Correo o contraseña incorrectos» | Baja | Reconocer también los códigos `auth/wrong-password` y `auth/user-not-found` |
| H-04 | UAT-13: a 20× el aviso de tendencia aparece una o dos lecturas antes de que la variable salga de rango | Informativo | Ninguna: es efecto de la demo acelerada |
| H-05 | Con ventanas de 1280 px la hoja de Registros se superpone al panel derecho | Baja | Ajustar las columnas de esa vista |
| — | Una primera corrida marcó 3 fallas (UAT-02, UAT-13, UAT-15). Eran errores del script de prueba, no de la aplicación: se corrigió el script y se repitió todo sobre datos limpios | — | Cerrada |

Los hallazgos de las pruebas de carga (H-01 y H-02) están en el [plan de pruebas](plan-de-pruebas.md), sección 7.

## 4. Aprobación

La UAT queda **aprobada** cuando la firme quien representa al usuario. QA no puede aprobarla por sí mismo.

| Rol | Nombre | Decisión | Fecha | Firma |
|---|---|---|---|---|
| Dueño del producto / cliente (Austral Chemicals) | | ☐ Aprobada ☐ Aprobada con observaciones ☐ Rechazada | | |
| Scrum Master y QA | Felipe Carreño | Ejecutada: 38 de 38 casos pasan | 23-11-2026 | |
| Técnico de hardware (casos con maqueta) | | ☐ Pendiente de ejecutar | | |

Observaciones de quien aprueba:

&nbsp;

&nbsp;
