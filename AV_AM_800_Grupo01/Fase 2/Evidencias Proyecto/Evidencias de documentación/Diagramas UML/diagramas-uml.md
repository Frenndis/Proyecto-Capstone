# StormCIP · Diagramas UML

Diagramas mínimos solicitados en el anexo *Artefactos y documentos solicitados por metodología*: casos de uso, secuencia de la funcionalidad principal, componentes y clases (modelo de dominio).

Están construidos a partir del código de la rama `feature/HL` (octubre 2026): `functions/src`, `firestore.rules` y `web/src`. GitHub dibuja los bloques Mermaid automáticamente; el diagrama de casos de uso está además en notación UML estándar en [`casos-de-uso.puml`](casos-de-uso.puml).

**Convención:** lo marcado como *pendiente* está en el plan pero aún no existe en el código; *sin pantalla* significa que el backend lo permite pero la web no tiene la opción.

---

## 1. Casos de uso

Tres roles de usuario, cada uno hereda lo del anterior (visor → operador → administrador), y un sistema externo: el sensor que envía datos a través de The Things Stack. Para que se lea fácil, cada actor se conecta a su grupo de casos de uso; la versión con una línea por caso, en notación UML estándar, está en [`casos-de-uso.puml`](casos-de-uso.puml).

*Extend:* se genera una alerta solo si el valor sale del umbral, y los indicadores se calculan solo al finalizar el ciclo.

```mermaid
flowchart LR
    Visor(["👤 Visor<br/>jefe de producción / cliente"])
    Oper(["👤 Operador"])
    Admin(["👤 Administrador"])
    Sensor(["⚙️ Sensor WQS-LB<br/>vía The Things Stack"])

    Admin -. hereda .-> Oper
    Oper -. hereda .-> Visor

    subgraph S["StormCIP"]
        direction LR
        subgraph C["Consultar"]
            direction TB
            UC01(["Iniciar sesión"])
            UC02(["Ver variables en tiempo real"])
            UC03(["Ver etapa del ciclo CIP"])
            UC04(["Ver alertas e historial"])
            UC05(["Ver indicadores del ciclo"])
            UC06(["Ver históricos 24 h / 7 días<br/>(pendiente)"])
            UC07(["Ver proyección de limpieza<br/>(pendiente)"])
        end
        subgraph O["Operar"]
            direction TB
            UC10(["Reconocer alerta"])
            UC11(["Gestionar ciclo<br/>(hoy por script)"])
            UC35(["Calcular indicadores<br/>al finalizar el ciclo"])
        end
        subgraph A["Administrar"]
            direction TB
            UC20(["Asignar roles<br/>(sin pantalla)"])
            UC21(["Ver estado de los equipos"])
            UC22(["Configurar umbrales<br/>(pendiente)"])
            UC23(["Recalcular indicadores"])
            UC24(["Controlar simulación de demo"])
        end
        subgraph I["Recibir datos"]
            direction TB
            UC30(["Enviar lectura"])
            UC31(["Enviar estado del equipo"])
            UC32(["Decodificar payload"])
            UC33(["Validar rango físico"])
            UC34(["Generar alerta por umbral"])
        end
    end

    Visor --> C
    Oper --> O
    Admin --> A
    Sensor --> I

    UC30 -. include .-> UC32
    UC30 -. include .-> UC33
    UC31 -. include .-> UC32
    UC34 -. extend .-> UC30
    UC35 -. extend .-> UC11
```

| Caso de uso | Actor | Historia | Dónde está implementado |
|---|---|---|---|
| Iniciar sesión | Todos | HU-08 | Firebase Authentication, `web/src/app/login` |
| Ver variables en tiempo real | Visor | HU-01 | `useDatosCip.ts` (escucha `ciclos` y `lecturas`) |
| Ver etapa del ciclo | Visor | HU-02 | `BarraEtapas.tsx`, `useEstadoProceso.ts` |
| Ver alertas e historial | Visor | HU-03 | `PanelAlertas.tsx`, `HistorialAlertas.tsx` |
| Ver indicadores del ciclo | Visor | HU-06 | `IndicadoresCiclo.tsx` |
| Reconocer alerta | Operador | HU-03 | `PanelAlertas.tsx`; la regla solo permite cambiar `reconocida*` |
| Gestionar ciclo | Operador | — | Las reglas lo permiten al operador; hoy lo hacen `scripts/cerrar-ciclo.js` y los simuladores |
| Asignar roles | Administrador | HU-09 | Función `setUserRole`; la web no la usa |
| Ver estado de los equipos | Administrador | HU-10 | Lectura de `dispositivos` (solo admin); tarjeta completa pendiente |
| Recalcular indicadores | Administrador | HU-06 | Función `recalcularIndicadores` y `scripts/recalcular.js` |
| Controlar simulación de demo | Administrador | HU-11 | `ControlSimulacion.tsx` escribe en `simulacionControl` |
| Enviar lectura / estado | Sensor | HU-12, HU-10 | Función `ttnUplink` (FPort 2 y FPort 5) |

---

## 2. Secuencia de la funcionalidad principal: una lectura del sensor llega al dashboard

Es el flujo central del sistema. El dashboard no consulta periódicamente: queda suscrito a Firestore y recibe los cambios apenas se escriben.

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
                    W->>W: actualiza tarjetas, tendencia y alertas
                end
            end
        end
    end
```

Puntos de diseño que muestra el diagrama:

- **Idempotencia:** el ID de la lectura es `devEui_segundos`, así que un reintento de The Things Stack no la duplica.
- **La etapa la decide el ciclo, no el sensor:** se lee `etapaActual` dentro de la transacción.
- **Rechazos de negocio responden 200:** así The Things Stack no reintenta en bucle; solo un secreto inválido responde 401.

---

## 3. Componentes

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

    subgraph GCP["Google Cloud · Firebase (southamerica-west1)"]
        direction LR
        subgraph Functions["Cloud Functions (Node 22)"]
            TTN["ttnUplink"]
            ING["ingestLectura<br/>/api/ingest"]
            PROC["procesarLectura<br/>(módulo compartido)"]
            CIERRE["alCerrarCiclo<br/>recalcularIndicadores"]
            ROLES["onUserCreated*<br/>setUserRole"]
        end
        FS[("Cloud Firestore")]
        AUTH["Firebase Authentication"]
        SM["Secret Manager<br/>TTN_WEBHOOK_SECRET"]
        HOST["Firebase Hosting"]
    end

    subgraph Cliente["Navegador"]
        WEB["Dashboard Next.js<br/>React + Recharts"]
    end

    subgraph Herramientas["Herramientas del equipo"]
        SCR["scripts/<br/>seed, simuladores, cerrar-ciclo"]
    end

    TTS -- "webhook HTTPS<br/>x-webhook-secret" --> TTN
    SM -. secreto .-> TTN
    SCR -- "HTTP POST + x-api-key" --> ING
    SCR -- "webhook simulado" --> TTN
    SCR -- "Admin SDK" --> FS
    TTN --> PROC
    ING --> PROC
    PROC -- "transacción" --> FS
    FS -- "trigger: ciclo finalizado" --> CIERRE
    CIERRE --> FS
    AUTH -- "trigger: usuario creado" --> ROLES
    ROLES -- "custom claim rol" --> AUTH
    HOST -- "sirve la app estática" --> WEB
    WEB -- "inicio de sesión" --> AUTH
    WEB -- "SDK: onSnapshot<br/>reglas por rol" --> FS
```

| Componente | Responsabilidad | Interfaz |
|---|---|---|
| `ttnUplink` | Autentica el webhook, decodifica FPort 2 y 5, resuelve el ciclo en curso | HTTPS POST con `x-webhook-secret` |
| `ingestLectura` | Endpoint para emisores que mandan JSON ya decodificado (simuladores, ESP32) | HTTPS POST `/api/ingest` con `x-api-key` (se guarda solo su hash) |
| `procesarLectura` | Valida rangos físicos, calcula derivados, escribe lectura y alertas en una transacción | Función interna compartida por los dos endpoints |
| `alCerrarCiclo` / `recalcularIndicadores` | Calcula los indicadores del ciclo | Trigger de Firestore / función *callable* (solo admin) |
| `onUserCreated` / `setUserRole` | Rol por defecto `visor` y cambio de rol | Trigger de Auth / *callable* (solo admin) |
| Cloud Firestore | Persistencia y tiempo real; las reglas aplican los permisos por rol | SDK cliente y Admin SDK |
| Dashboard web | Visualización en vivo, alertas, indicadores, control de demo | Exportación estática en Firebase Hosting |

\* `onUserCreated` corre en `southamerica-east1`: es de 1ª generación y esa generación no existe en `southamerica-west1`.

---

## 4. Clases: modelo de dominio

El código no usa clases (es TypeScript con funciones y tipos), así que el diagrama de clases representa el **modelo de dominio**: los documentos de Firestore, sus atributos principales y cómo se relacionan. Los tipos están en `functions/src/types.ts`.

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
    class Ciclo {
        plantaId
        lineaId
        camion
        programa
        estado : en_curso | finalizado | abortado
        etapaActual : Etapa
        inicio
        fin
        ultimaLectura : mapa por dispositivo
        variablesVistas : mapa por dispositivo
        indicadores
        indicadoresMetodo
        indicadoresConfianza
        consumos
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
    }
    class Configuracion {
        umbrales : rango por etapa y variable
        calculos : factorCompensacionEC, conductividadAguaRed, caudalNominalM3h, criterioLimpio
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
    Ciclo "1" *-- "*" Lectura : subcolección lecturas
    Ciclo "1" -- "*" Alerta : cicloId
    Linea "1" -- "*" Dispositivo : lineaId
    Dispositivo "1" *-- "1..3" Sonda : mapa sondas
    Dispositivo "1" -- "*" Lectura : deviceId
    Linea "1" -- "0..1" EstadoProceso : un documento por línea
    Configuracion ..> Alerta : umbrales
    Configuracion ..> Lectura : parámetros de cálculo
```

Notas del modelo:

- **Lectura** vive dentro de su **Ciclo** (`ciclos/{id}/lecturas`); el histórico entre ciclos se consulta como grupo de colección.
- **Etapa** toma los valores `preenjuague`, `alcalino`, `enjuague`, `acido`, `enjuague_final` y `desinfeccion`; solo las tres de agua están dentro del rango de las sondas.
- **Confianza** de cada valor: `medido`, `estimado`, `saturado` o `fuera_de_operacion`.
- **Alerta** tiene un ID determinista `{ciclo}_{etapa}_{variable}`, para no duplicarse; un episodio reconocido que vuelve a dispararse se reescribe como nuevo.
- `simulacionControl` y `simulacionEstado` (uno por línea) existen solo para la demo y no se incluyen en el diagrama.
