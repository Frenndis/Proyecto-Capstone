# Sprint 1 · Backend / Firebase — StormCIP
**Objetivo:** Crear proyecto en Firebase/GCP y definir estructura (Auth, Firestore, Functions, Hosting).

## Estructura
```
stormcip/
├─ firebase.json            # Firestore, Functions, Hosting, emuladores
├─ .firebaserc              # id del proyecto (cambiar "stormcip-dev")
├─ firestore.rules          # seguridad por rol (custom claims)
├─ firestore.indexes.json
├─ functions/src/
│  ├─ index.ts              # región southamerica-west1 (Santiago)
│  ├─ ingest.ts             # POST /api/ingest  ← ESP32 / gateway / simulador
│  ├─ auth.ts               # rol por defecto + setUserRole (solo admin)
│  └─ types.ts              # variables, etapas CIP, roles
├─ scripts/ seed.js · simulador.js
└─ web/                     # Next.js (static export → Hosting)
```

## Modelo de datos (Firestore)
| Colección | Campos clave |
|---|---|
| `users/{uid}` | email, nombre, rol (admin/operador/visor) |
| `plantas/{id}` → `lineas/{id}` | nombre, cliente / nombre, anden, estado |
| `ciclos/{id}` | plantaId, lineaId, camion, programa, estado, etapaActual, inicio, fin, consumos{}, ultimaLectura |
| `ciclos/{id}/lecturas/{id}` | ts, etapa, deviceId, temperatura, concentracion, caudal, presion, ph, turbidez, conductividad, nivel |
| `alertas/{id}` | cicloId, lineaId, etapa, variable, valor, min, max, severidad, ts, reconocida |
| `dispositivos/{id}` | lineaId, tipo, apiKeyHash, activo, ultimoPing |
| `configuracion/umbrales` | rangos {min,max} por etapa y variable |

Flujo: **Sensor → ESP32 → POST /api/ingest → Firestore → Dashboard (onSnapshot en tiempo real)**

## Tareas del Sprint
- [ ] Crear proyecto en consola Firebase (vincula GCP automáticamente)
- [ ] Activar plan **Blaze** (obligatorio para Functions; poner alerta de presupuesto en GCP)
- [ ] Firestore en modo producción, ubicación `southamerica-west1` (**no se puede cambiar después**)
- [ ] Auth: habilitar Email/Password
- [ ] Hosting: registrar app web y copiar config a `web/.env.local`
- [ ] `firebase login` · `firebase use --add` · actualizar `.firebaserc`
- [ ] Probar local con emuladores + seed + simulador
- [ ] Deploy: `firebase deploy --only firestore,functions,hosting`
- [ ] Crear primer admin real (script seed adaptado sin emulador, o consola + setCustomUserClaims)

## Correr en local
```bash
npm i -g firebase-tools
cd functions && npm i && npm run build && cd ..
firebase emulators:start                 # UI en http://127.0.0.1:4000
cd scripts && npm i && npm run seed && npm run sim   # otra terminal
```
Ver en la UI de emuladores cómo llegan `lecturas` y se generan `alertas` (turbidez > 40).

## Definition of Done
- Proyecto creado y desplegado; emuladores funcionando para todo el equipo.
- `/api/ingest` rechaza dispositivos sin key (401) y datos inválidos (400).
- Reglas: visor solo lee; operador reconoce alertas; solo admin cambia roles/config.

## Pendiente para próximos sprints
- Anti-spam de alertas (no repetir la misma alerta por cada lectura).
- Restringir lectura por planta del usuario (`users.plantaIds`).
- Agregados por ciclo (consumos) para el ML; exportar lecturas a BigQuery si crece el volumen.
