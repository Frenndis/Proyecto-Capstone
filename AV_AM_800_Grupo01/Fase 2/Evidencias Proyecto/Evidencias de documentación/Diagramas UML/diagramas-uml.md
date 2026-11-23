# StormCIP · Diagramas UML

Diagramas mínimos solicitados en el anexo *Artefactos y documentos solicitados por metodología*: casos de uso, secuencia de la funcionalidad principal, componentes y clases (modelo de dominio).

**Versión 2 · 23-11-2026.** Construidos a partir del código de `main` al 23-11-2026 (commit `22125d2`): `functions/src`, `firestore.rules` y `web/src`. La versión 1 (26-10-2026) se basaba en la rama `feature/HL`; los cambios están al final, en *Control de cambios*. GitHub dibuja los bloques Mermaid automáticamente; el diagrama de casos de uso está además en notación UML estándar en [`casos-de-uso.puml`](casos-de-uso.puml), y las cuatro imágenes están en [`imagenes/`](imagenes).

**Convención:** *sin pantalla* significa que el backend lo permite pero la web no tiene la opción. Los datos de la planta de demostración (8 circuitos) son simulados; la línea piloto con sensores reales es `cip-01`.

---

## 1. Casos de uso

Tres roles de usuario, cada uno hereda lo del anterior (visor → operador → administrador), y dos actores que no son personas: el sensor, que envía datos a través de The Things Stack, y el tiempo, que dispara la planificación de ciclos de la planta de demostración. Para que se lea fácil, cada actor se conecta a su grupo de casos de uso; la versión con una línea por caso, en notación UML estándar, está en [`casos-de-uso.puml`](casos-de-uso.puml).

*Extend:* se genera una alerta solo si el valor sale del umbral, la proyección se calcula solo en las etapas de enjuague, y los indicadores y las recomendaciones se recalculan solo al cerrar el ciclo.

```mermaid
flowchart LR
    Visor(["👤 Visor<br/>jefe de producción / cliente"])
    Oper(["👤 Operador"])
    Admin(["👤 Administrador"])
    Sensor(["⚙️ Sensor WQS-LB<br/>vía The Things Stack"])
    Tiempo(["⏱️ Tiempo<br/>cada 60 min"])

    Admin -. hereda .-> Oper
    Oper -. hereda .-> Visor

    subgraph S["StormCIP"]
        direction LR
        subgraph C["Consultar"]
            direction TB
            UC01(["Iniciar sesión"])
            UC02(["Ver Central CIP<br/>circuitos y limpiezas del día"])
            UC03(["Ver ciclo en vivo<br/>variables y etapa"])
            UC04(["Ver gráfico por<br/>variables y periodo"])
            UC05(["Ver proyección y<br/>avisos de tendencia"])
            UC06(["Ver alertas e historial"])
            UC07(["Ver registros de ciclo<br/>e indicadores"])
            UC08(["Ver consumos de<br/>agua y químico"])
            UC09(["Ver reporte para gerencia"])
            UC12(["Ver predicción y ahorro"])
        end
        subgraph O["Operar"]
            direction TB
            UC10(["Reconocer alerta"])
            UC11(["Iniciar o detener<br/>ciclo de demostración"])
            UC35(["Calcular indicadores<br/>al cerrar el ciclo"])
            UC36(["Recalcular<br/>recomendaciones"])
        end
        subgraph A["Administrar"]
            direction TB
            UC20(["Gestionar usuarios y roles"])
            UC22(["Gestionar planes de<br/>limpieza y límites"])
            UC25(["Decidir recomendaciones<br/>aprobar, mantención, descartar"])
            UC21(["Ver estado de los equipos<br/>(sin pantalla)"])
            UC23(["Recalcular indicadores"])
            UC24(["Controlar simulación<br/>de la línea piloto"])
        end
        subgraph I["Recibir datos"]
            direction TB
            UC30(["Enviar lectura"])
            UC31(["Enviar estado del equipo"])
            UC32(["Decodificar payload"])
            UC33(["Validar rango físico"])
            UC34(["Generar alerta por umbral"])
            UC37(["Proyectar fin<br/>del enjuague"])
        end
        subgraph T["Planificar"]
            direction TB
            UC40(["Generar ciclos programados<br/>de la planta de demostración"])
        end
    end

    Visor --> C
    Oper --> O
    Admin --> A
    Sensor --> I
    Tiempo --> T

    UC30 -. include .-> UC32
    UC30 -. include .-> UC33
    UC31 -. include .-> UC32
    UC34 -. extend .-> UC30
    UC37 -. extend .-> UC30
    UC35 -. extend .-> UC11
    UC36 -. extend .-> UC11
```

| Caso de uso | Actor | Historia | Dónde está implementado |
|---|---|---|---|
| Iniciar sesión | Todos | HU-08 | Firebase Authentication, `web/src/app/login`; cada pantalla muestra solo lo que el rol permite |
| Ver Central CIP | Visor | — | `app/(panel)/central` |
| Ver ciclo en vivo | Visor | HU-01, HU-02 | `app/(panel)/dashboard` → `CicloEnVivoPagina.tsx`, `VistaCiclo.tsx` |
| Ver gráfico por variables y periodo | Visor | HU-04 | `GraficoPeriodo.tsx`: este ciclo, hoy, 7 días, 30 días o entre fechas |
| Ver proyección y avisos de tendencia | Visor | HU-07 | `ProyeccionCiclo.tsx`, `lib/tendencia.ts` (minutos y nivel de confianza) |
| Ver alertas e historial | Visor | HU-03 | `PanelAlertas.tsx` en `app/(panel)/sensores` |
| Ver registros de ciclo e indicadores | Visor | HU-06 | `app/(panel)/registros` (con «Imprimir registro») |
| Ver consumos de agua y químico | Visor | HU-05 | `app/(panel)/consumos` |
| Ver reporte para gerencia | Visor | — | `app/(panel)/reportes` (con «Imprimir informe») |
| Ver predicción y ahorro | Visor | HU-07 | `app/(panel)/prediccion` (lee `configuracion/oportunidades`) |
| Reconocer alerta | Operador | HU-03 | `PanelAlertas.tsx`; la regla solo permite cambiar `reconocida*` |
| Iniciar o detener ciclo de demostración | Operador | HU-11 | Función `iniciarCicloDemo` (rechaza al visor); detener escribe `detener: true` en el ciclo |
| Calcular indicadores al cerrar el ciclo | Sistema | HU-06 | Trigger `alCerrarCiclo` |
| Recalcular recomendaciones | Sistema | HU-07 | Trigger `recalcularDecisiones` con los modelos de `planta/ml.ts` |
| Gestionar usuarios y roles | Administrador | HU-09 | `app/(panel)/usuarios`; funciones `listarUsuarios`, `crearUsuario`, `setUserRole`, `setUserActivo`; restablecer contraseña por correo. No deja la planta sin administrador |
| Gestionar planes de limpieza y límites | Administrador | — | `app/(panel)/configuracion`; funciones `asegurarPlanes`, `guardarPlan`, `eliminarPlan` (validan el plan en el servidor) |
| Decidir recomendaciones | Administrador | HU-07 | `app/(panel)/prediccion`; guarda el estado en `configuracion/decisiones` |
| Ver estado de los equipos | Administrador | HU-10 | Lectura de `dispositivos` (solo admin); la web aún no tiene la tarjeta |
| Recalcular indicadores | Administrador | HU-06 | Función `recalcularIndicadores` y `scripts/recalcular.js` |
| Controlar simulación de la línea piloto | Administrador | HU-11 | `ControlSimulacion.tsx` escribe en `simulacionControl`; requiere el simulador corriendo (`npm run sim:cip`) |
| Enviar lectura / estado | Sensor | HU-12, HU-10 | Función `ttnUplink` (FPort 2 y FPort 5) |
| Proyectar fin del enjuague | Sistema | HU-07 | Trigger `alCrearLectura` (solo en enjuague y enjuague final) |
| Generar ciclos programados | Tiempo | — | Función programada `planificarCiclos` (cada 60 min, según la hora y los días de cada plan) |

---

## 2. Secuencia de la funcionalidad principal: una lectura del sensor llega al dashboard

Es el flujo central del sistema. El dashboard no consulta periódicamente: queda suscrito a Firestore y recibe los cambios apenas se escriben. Al final, la lectura nueva dispara la proyección del fin del enjuague.

```mermaid
sequenceDiagram
    autonumber
    participant S as Sonda + nodo WQS-LB
    participant G as Gateway UG65
    participant T as The Things Stack
    participant U as ttnUplink<br/>(lorawanAdapter.ts)
    participant D as wqsDecoder.ts
    participant P as procesarLectura<br/>(ingest.ts)
    participant F as Firestore
    participant X as alCrearLectura<br/>(proyeccionEnjuague.ts)
    participant W as Dashboard web

    W->>F: onSnapshot(ciclo en curso, lecturas, alertas)
    Note over W,F: El dashboard queda suscrito antes de que llegue el dato

    S->>G: Uplink LoRaWAN (FPort 2, bytes)
    G->>T: Reenvía el paquete
    T->>U: POST webhook (frm_payload, dev_eui, received_at)<br/>header x-webhook-secret

    alt Secreto inválido
        U-->>T: 401
    else FPort 5 (estado del equipo)
        U->>D: decodeWqs(bytes, 5)
        U->>F: update dispositivos/{id} (firmware, batería, ultimoPing)
        U-->>T: 200
    else FPort 2 (lectura)
        U->>F: get dispositivos/{deviceId}
        alt Dispositivo desconocido
            U-->>T: 200 ignorado
        else Dispositivo registrado
            U->>D: decodeWqs(bytes, 2, firmware)
            D-->>U: valores o error de formato
            U->>F: busca el ciclo "en_curso" de la línea
            alt Sin ciclo en curso o payload no válido
                U-->>T: 200 ignorado (con log)
            else Ciclo encontrado
                U->>P: procesarLectura(valores, lecturaId = devEui_ts)
                P->>P: validar rango físico de cada sonda<br/>y calcular derivados (conductividad a 25 °C)
                P->>F: get configuracion/umbrales y calculos
                P->>F: runTransaction
                activate F
                F-->>P: lectura existente? + ciclo (etapaActual)
                alt La lectura ya existía (reintento de la red)
                    P-->>U: duplicado
                    U-->>T: 200 duplicado
                else Lectura nueva
                    P->>F: set ciclos/{id}/lecturas/{lecturaId}
                    P->>F: update ciclo.ultimaLectura y variablesVistas
                    opt Valor fuera del umbral de la etapa
                        P->>F: set alertas/{ciclo_etapa_variable}
                    end
                    P->>F: update dispositivos/{id}.ultimoPing
                    deactivate F
                    P-->>U: ok (alertas, descartadas)
                    U-->>T: 201
                    F-->>W: cambios en ciclo, lecturas y alertas
                    W->>W: actualiza tarjetas, gráfico y alertas
                    F-)X: trigger: lectura creada
                    opt Etapa de enjuague o enjuague final
                        X->>F: update ciclo.proyeccionEnjuague.{deviceId}
                        F-->>W: proyección actualizada
                        W->>W: muestra minutos restantes y confianza
                    end
                end
            end
        end
    end
```

Puntos de diseño que muestra el diagrama:

- **Idempotencia:** el ID de la lectura es `devEui_segundos`, así que un reintento de The Things Stack no la duplica.
- **La etapa la decide el ciclo, no el sensor:** se lee `etapaActual` dentro de la transacción.
- **Rechazos de negocio responden 200:** así The Things Stack no reintenta en bucle; solo un secreto inválido responde 401.
- **La proyección va aparte:** la calcula un trigger después de guardar la lectura, para no alargar la respuesta al webhook.

---

## 3. Componentes

Las 17 funciones están desplegadas en el proyecto `stormcip-austral` (23-11-2026). Quince corren en `southamerica-west1` (Santiago); las dos marcadas con \* corren en `southamerica-east1` (São Paulo).

```mermaid
flowchart TB
    subgraph Campo["Planta / maqueta"]
        direction LR
        PH["Sonda DR-PH01<br/>pH + temperatura"]
        EC["Sonda DR-ECK1.0<br/>conductividad + temperatura"]
        WQS["Nodo WQS-LB<br/>LoRaWAN AU915"]
        FLU["Flujómetro SW3L-LB-006<br/>(sin decoder aún)"]
        GW["Gateway Milesight UG65"]
        PH -- RS485 --> WQS
        EC -- RS485 --> WQS
        WQS -- LoRa --> GW
        FLU -. LoRa .-> GW
    end

    TTS["The Things Stack<br/>servidor de red LoRaWAN"]
    GW -- "Internet" --> TTS

    subgraph GCP["Google Cloud · Firebase · proyecto stormcip-austral"]
        direction TB
        subgraph Functions["Cloud Functions (Node 22) · 17 funciones"]
            direction LR
            subgraph Ingesta["Ingesta"]
                TTN["ttnUplink"]
                ING["ingestLectura<br/>/api/ingest"]
                PROC["procesarLectura<br/>(módulo compartido)"]
            end
            subgraph Calculos["Cálculos del ciclo"]
                CIERRE["alCerrarCiclo<br/>recalcularIndicadores"]
                PROY["alCrearLectura<br/>proyección del enjuague"]
                VOL["alCambiarEstadoProceso<br/>volumen circulado"]
            end
            subgraph Planta["Planta de demostración y predicción"]
                DEMO["iniciarCicloDemo<br/>planificarCiclos*"]
                DEC["recalcularDecisiones"]
                ML["Modelos Random Forest<br/>(planta/ml.ts)"]
            end
            subgraph Gestion["Gestión"]
                PLANES["asegurarPlanes<br/>guardarPlan · eliminarPlan"]
                USR["onUserCreated* · setUserRole<br/>listarUsuarios · crearUsuario<br/>setUserActivo"]
            end
        end
        FS[("Cloud Firestore<br/>reglas por rol")]
        AUTH["Firebase Authentication"]
        SM["Secret Manager<br/>TTN_WEBHOOK_SECRET"]
        HOST["Firebase Hosting<br/>stormcip-austral.web.app"]
    end

    subgraph Cliente["Navegador"]
        WEB["Web Next.js<br/>Central CIP · Ciclo en vivo · Registros · Consumos<br/>Predicción · Reportes · Sensores · Planes · Usuarios"]
    end

    subgraph Herramientas["Herramientas del equipo"]
        SCR["scripts/<br/>seed, simuladores, pruebas de carga y UAT"]
    end

    TTS -- "webhook HTTPS<br/>x-webhook-secret" --> TTN
    SM -. secreto .-> TTN
    SCR -- "HTTP POST + x-api-key" --> ING
    SCR -- "webhook simulado" --> TTN
    SCR -- "Admin SDK" --> FS
    TTN --> PROC
    ING --> PROC
    PROC -- "transacción" --> FS
    Calculos <-- "triggers de Firestore<br/>y escrituras" --> FS
    Planta <-- "trigger: ciclo actualizado<br/>ciclos y oportunidades" --> FS
    DEC --> ML
    Gestion -- "configuracion/planes<br/>users" --> FS
    USR <-- "trigger: usuario creado<br/>custom claim rol" --> AUTH
    HOST -- "sirve la app estática" --> WEB
    WEB -- "inicio de sesión" --> AUTH
    WEB -- "SDK: onSnapshot<br/>reglas por rol" --> FS
    WEB -- "callables<br/>(rol validado en el servidor)" --> Functions
```

| Componente | Responsabilidad | Interfaz |
|---|---|---|
| `ttnUplink` | Autentica el webhook, decodifica FPort 2 y 5, resuelve el ciclo en curso | HTTPS POST con `x-webhook-secret` |
| `ingestLectura` | Endpoint para emisores que mandan JSON ya decodificado (simuladores, ESP32) | HTTPS POST `/api/ingest` con `x-api-key` (se guarda solo su hash) |
| `procesarLectura` | Valida rangos físicos, calcula derivados, escribe lectura y alertas en una transacción | Función interna compartida por los dos endpoints |
| `alCerrarCiclo` / `recalcularIndicadores` | Calcula los indicadores del ciclo | Trigger de Firestore / *callable* (solo admin) |
| `alCrearLectura` | Proyecta en minutos el fin del enjuague, con nivel de confianza | Trigger de Firestore (lectura creada) |
| `alCambiarEstadoProceso` | Integra el caudal y acumula los litros circulados por etapa | Trigger de Firestore (`estadoProceso`) |
| `iniciarCicloDemo` | Inicia un ciclo de la planta de demostración con su plan | *Callable* (operador o admin) |
| `planificarCiclos` \* | Genera los ciclos programados de cada circuito según su plan | Función programada, cada 60 min |
| `recalcularDecisiones` + `planta/ml.ts` | Recalcula las predicciones (Random Forest) y las recomendaciones de ahorro | Trigger de Firestore (ciclo actualizado) |
| `asegurarPlanes` / `guardarPlan` / `eliminarPlan` | Planes de limpieza por defecto, alta, modificación y baja, con validación | *Callables* (gestión: solo admin) |
| `onUserCreated` \* / `setUserRole` / `listarUsuarios` / `crearUsuario` / `setUserActivo` | Rol por defecto `visor`, alta de cuentas, cambio de rol, activar o desactivar | Trigger de Auth / *callables* (solo admin) |
| Cloud Firestore | Persistencia y tiempo real; las reglas aplican los permisos por rol | SDK cliente y Admin SDK |
| Web | Visualización, gestión y control de la demo según el rol | Exportación estática en Firebase Hosting |

\* `onUserCreated` es de 1ª generación y esa generación no existe en `southamerica-west1`; `planificarCiclos` es la función programada.

---

## 4. Clases: modelo de dominio

El código no usa clases (es TypeScript con funciones y tipos), así que el diagrama de clases representa el **modelo de dominio**: los documentos de Firestore, sus atributos principales y cómo se relacionan. Los tipos están en `functions/src/types.ts` y `functions/src/planta/`.

```mermaid
classDiagram
    direction LR

    class Planta {
        nombre
        cliente
        proveedor
    }
    class Linea {
        nombre
        anden
        estado
    }
    class PlanLimpieza {
        id : circuito
        nombre
        area
        receta
        hora
        libres : días sin ciclo
        activo
    }
    class FasePlan {
        n : nombre de la fase
        etapa : Etapa
        min : duración
        t : temperatura objetivo
        c : concentración objetivo
        tMin : temperatura mínima de validación
        q : caudal
    }
    class Ciclo {
        numero : CIP-0000
        plantaId
        lineaId
        circuitoId
        programa
        estado : en_curso | finalizado | abortado
        etapaActual : Etapa
        inicio
        fin
        ultimaLectura : mapa por dispositivo
        indicadores
        consumos
        volumenCirculado
        proyeccionEnjuague
        prediccion
        simulado
    }
    class Lectura {
        v : versión de esquema
        ts
        etapa : Etapa
        deviceId
        valores
        derivados
        metodo
        confianza
        hex
        bateriaV
    }
    class Alerta {
        cicloId
        lineaId
        etapa
        variable
        tipo : umbral | saturacion
        min
        max
        severidad
        desde
        hasta
        conteo
        ultimoValor
        reconocida
    }
    class Dispositivo {
        plantaId
        lineaId
        tipo
        activo
        apiKeyHash
        devEui
        firmware
        firmwareReportado
        bateriaV
        ultimoPing
    }
    class Sonda {
        sondaId
        modelo : DR-PH01 | DR-ECK1.0 | …
        activa
        ultimaCalibracion
    }
    class Usuario {
        email
        nombre
        rol : admin | operador | visor
        activo
    }
    class Configuracion {
        umbrales : rango por etapa y variable
        calculos : parámetros de cálculo
    }
    class Prediccion {
        circuitoId
        aguaL · aguaP10 · aguaP90
        quimicoL · quimicoP10 · quimicoP90
        duracionS
        error del modelo
    }
    class Decision {
        tipo : acortar_enjuague | ajustar_dosis | revisar_circuito | posible_fuga
        circuitoId
        fase
        propuesta
        aguaMesL
        quimicoMesL
        confianza : alta | media
    }
    class EstadoDecision {
        estado : aprobada | descartada
        por
        en
    }
    class EstadoProceso {
        etapa
        progresoEtapa
        instrumentos
        estanques
        circuito
        simulado
    }

    Planta "1" *-- "*" Linea : subcolección
    Linea "1" -- "*" Ciclo : lineaId
    PlanLimpieza "1" *-- "1..*" FasePlan : fases
    PlanLimpieza "1" -- "*" Ciclo : circuitoId
    Ciclo "1" *-- "*" Lectura : subcolección lecturas
    Ciclo "1" -- "*" Alerta : cicloId
    Linea "1" -- "*" Dispositivo : lineaId
    Dispositivo "1" *-- "1..3" Sonda : mapa sondas
    Dispositivo "1" -- "*" Lectura : deviceId
    Linea "1" -- "0..1" EstadoProceso : un documento por línea
    PlanLimpieza "1" -- "0..1" Prediccion : por circuito
    PlanLimpieza "1" -- "*" Decision : circuitoId
    Decision "1" -- "0..1" EstadoDecision : la registra el admin
    Configuracion ..> Alerta : umbrales
    Configuracion ..> Lectura : parámetros de cálculo
```

Notas del modelo:

- **Lectura** vive dentro de su **Ciclo** (`ciclos/{id}/lecturas`); el histórico entre ciclos se consulta como grupo de colección.
- **PlanLimpieza** se guarda en `configuracion/planes` (un documento con los 8 planes de fábrica y los que cree el administrador). Un plan corresponde a un circuito; el ciclo copia sus fases al iniciarse.
- **Predicción** y **Decisión** se guardan juntas en `configuracion/oportunidades` (las recalcula `recalcularDecisiones`); **EstadoDecision**, en `configuracion/decisiones`.
- **Etapa** toma los valores `preenjuague`, `alcalino`, `enjuague`, `acido`, `enjuague_final` y `desinfeccion`; solo las tres de agua están dentro del rango de las sondas.
- **Configuracion.calculos** guarda `factorCompensacionEC`, `conductividadAguaRed`, `caudalNominalM3h` y `criterioLimpio`.
- **Confianza** de cada valor: `medido`, `estimado`, `saturado` o `fuera_de_operacion`.
- **Alerta** tiene un ID determinista `{ciclo}_{etapa}_{variable}`, para no duplicarse; un episodio reconocido que vuelve a dispararse se reescribe como nuevo.
- **Usuario** guarda el rol también como *custom claim* de Firebase Authentication, que es lo que leen las reglas; `activo: false` deshabilita la cuenta.
- `simulacionControl`, `simulacionEstado`, `configuracion/contador` y `ciclos/{id}/eventosVolumen` son documentos de apoyo (control de la demo, numeración y cálculo del volumen) y no se incluyen en el diagrama.

---

## Control de cambios

| Versión | Fecha | Cambios |
|---|---|---|
| 1 | 26-10-2026 | Primera versión, desde la rama `feature/HL`. |
| 2 | 23-11-2026 | Desde `main` (commit `22125d2`). **Casos de uso:** pasan a existentes los históricos (gráfico por variables y periodo), la proyección, la gestión del ciclo desde la web, la asignación de roles (pantalla Usuarios) y la configuración (planes de limpieza y límites); se agregan Central CIP, registros, consumos, reportes, predicción y ahorro, decidir recomendaciones y el actor Tiempo. **Secuencia:** se agrega la proyección del fin del enjuague. **Componentes:** de 6 a 17 funciones, módulo de predicción y proyecto `stormcip-austral`. **Modelo de dominio:** se agregan PlanLimpieza, FasePlan, Predicción, Decisión y EstadoDecision, y `activo` en Usuario. |
