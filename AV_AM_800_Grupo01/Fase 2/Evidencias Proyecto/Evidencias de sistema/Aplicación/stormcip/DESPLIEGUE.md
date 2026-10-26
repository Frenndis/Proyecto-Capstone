# Despliegue de StormCIP — proyecto real (`stormcip-972bd`)

Este documento describe el primer despliegue contra el proyecto Firebase real
del grupo. **Ningún comando de este documento se ejecuta solo** — cada uno
requiere revisión y aprobación explícita antes de correrlo, porque el
proyecto es compartido con el resto del equipo.

En todo comando de este documento se pasa `--project stormcip-972bd`
explícito. No confiar en el proyecto "activo" por defecto del CLI: en
algunas máquinas puede haber quedado fijado un proyecto distinto (ver nota al
final).

**Regla para los scripts de `scripts/`: ningún script toca producción sin
flags explícitos.** Sin flags usan los emuladores (o se niegan si no tienen un
destino claro). Ninguno decide el destino por variables de entorno
(`PROJECT_ID`, `INGEST_URL`), y todos se niegan si encuentran variables de
emulador junto con los flags de producción.

| Script | Producción solo con |
|---|---|
| `cerrar-ciclo.js`, `recalcular.js`, `rotar-key.js`, `simulador-prod.js`, `simulador-cip.js` | `--prod --project stormcip-972bd` (guardarraíles compartidos en `scripts/entorno.js`; además se niegan si encuentran `PROJECT_ID=stormcip-972bd` sin `--prod`) |
| `seed-prod.js`, `produccion-plantilla.js` | `--project stormcip-972bd --confirmar` (solo producción; 5 s para cancelar) |
| `seed.js`, `simulador.js`, `simulador-ttn.js`, `e2e-quimica.js`, `e2e-volumen.js` | Nunca: solo emuladores |

Las credenciales de los scripts con Admin SDK son las de
`gcloud auth application-default login`. Igual que los comandos de este
documento, cada ejecución contra producción requiere aprobación explícita.

## 0) Requisitos

- Plan **Blaze** activo en `stormcip-972bd` (Cloud Functions v2 lo exige).
- Cuenta con permisos suficientes: rol Editor/Owner, o como mínimo
  Cloud Functions Admin + Cloud Datastore/Firestore + Secret Manager Admin +
  Service Account User.
- `firebase login` con la cuenta que tiene esos permisos.
- Node 22 (igual que `functions/package.json`).
- Antes de cualquier comando: correr `firebase use` (sin argumentos) y
  confirmar que coincide con lo que se espera pasarle a `--project`. Si no
  coincide, no asumir — corregirlo primero (ver nota al final) o simplemente
  seguir pasando `--project stormcip-972bd` explícito en cada comando, que es
  lo que hace este documento.

## Nota: regiones de las funciones (no todas están en la misma)

Seis funciones corren en `southamerica-west1` (Santiago): `ttnUplink`,
`ingestLectura`, `setUserRole`, `alCerrarCiclo`, `recalcularIndicadores` y
`alCambiarEstadoProceso` — las seis son Cloud Functions 2ª
generación. `onUserCreated` corre en `southamerica-east1` (São Paulo): es
la única de 1ª generación (usa el trigger `auth.user().onCreate`, que no
existe en 2ª gen), y `southamerica-west1` no admite 1ª generación. Ver el
comentario junto a `onUserCreated` en `functions/src/auth.ts`.

⚠️ **Una función mal configurada puede tumbar el deploy de otras, aunque no
estén nombradas en el `--only`.** Las 7 funciones viven en un solo codebase
(`functions/src/index.ts`); Firebase CLI carga y evalúa ese archivo completo
para descubrir todos los triggers **antes** de aplicar el filtro `--only`
— es decir, `--only functions:ttnUplink,functions:ingestLectura` no evita
que el CLI también evalúe `onUserCreated`. Si esa evaluación produce una
región inválida para la generación de alguna función (como pasó con
`onUserCreated` en `southamerica-west1`), la llamada a `generateUploadUrl`
puede fallar para todo el codebase, aunque la función mal configurada no
esté en el `--only`. Por eso, al tocar la región de cualquier función,
conviene correr `npx tsc --noEmit` y revisar `functions/src/index.ts`
completo, no solo el archivo de la función que se piensa desplegar.

## 1) Solo lectura: comparar qué hay desplegado antes de tocar nada

```
firebase functions:list --project stormcip-972bd
```

Esto lista las funciones que **ya están publicadas** en el proyecto real.
Compararlo contra lo que existe hoy en `functions/src/index.ts`:

| Función | Tipo | Región | En el código |
|---|---|---|---|
| `ttnUplink` | v2 HTTP | `southamerica-west1` | Sí |
| `ingestLectura` | v2 HTTP | `southamerica-west1` | Sí |
| `setUserRole` | v2 callable | `southamerica-west1` | Sí |
| `alCerrarCiclo` | v2 Firestore (`ciclos/{cicloId}`, al actualizar) | `southamerica-west1` | Sí |
| `recalcularIndicadores` | v2 callable | `southamerica-west1` | Sí |
| `onUserCreated` | v1 (auth trigger) | `southamerica-east1` | Sí |
| `alCambiarEstadoProceso` | v2 Firestore (`estadoProceso/{lineaId}`) | `southamerica-west1` | Sí |

Si en el output de `functions:list` aparecen funciones de otros compañeros
que no están en este listado (por ejemplo, algo de otra rama que ya se
desplegó), **no incluirlas** en el `--only` del paso 3 — ese flag reemplaza
únicamente las funciones nombradas, no toca el resto, pero es la única forma
de estar seguros de qué se va a tocar antes de correr el deploy.

## 2) Configurar el secreto real (una sola vez, antes del primer deploy)

```
firebase functions:secrets:set TTN_WEBHOOK_SECRET --project stormcip-972bd
```

Pide el valor de forma interactiva (no lo tipees en un script ni lo pegues en
este documento). Crea el secreto en Secret Manager del proyecto real; el
código ya está preparado para leerlo vía `defineSecret` (`lorawanAdapter.ts`).

## 3) Deploy de funciones (solo las nombradas)

```
firebase deploy --project stormcip-972bd --only functions:ttnUplink,functions:ingestLectura
```

Nunca `--only functions` a secas (borraría/redeployaría funciones de otros
compañeros que no estén en el código local en ese momento). Si además se
necesita desplegar `setUserRole` u `onUserCreated`, agregarlas explícitas al
mismo `--only`, separadas por coma — decidir eso recién después de comparar
con el paso 1.

## 3.1) Orden obligatorio al desplegar el dashboard completo (reglas → funciones → Hosting)

Aplica cuando se despliega `feature/HL` (dashboard nuevo + backend nuevo). Cada
paso se aprueba por separado y **no se cambia el orden**:

1. **Reglas** (`firestore.rules`). El dashboard nuevo lee `estadoProceso`; sin la
   regla recibiría `permission-denied`. `firestore:rules` **reemplaza las reglas
   completas** del proyecto: antes, comparar las publicadas en la consola con las
   del repo (la única diferencia esperada contra la rama CR es el bloque
   `estadoProceso`). Los índices no cambian (`firestore.indexes.json` es idéntico).

   ```
   firebase deploy --project stormcip-972bd --only firestore:rules
   ```

2. **Funciones**, solo las que cambiaron y siempre con `--only`. En PowerShell el
   valor va **entre comillas** (sin ellas la coma lo parte):

   ```
   firebase deploy --project stormcip-972bd --only "functions:ttnUplink,functions:ingestLectura,functions:alCerrarCiclo,functions:recalcularIndicadores,functions:alCambiarEstadoProceso"
   ```

   El `predeploy` compila `functions/` (`npm run build`). Las funciones nuevas
   escriben campos que el dashboard nuevo muestra (`confianza`, `descartadas`,
   `variablesVistas`), por eso van antes que Hosting.

   `alCambiarEstadoProceso` integra el caudal de `estadoProceso` y escribe
   `ciclos/{id}.volumenCirculado` (lo que muestra la sección "Volumen circulado" del
   dashboard) y un marcador por evento en `ciclos/{id}/eventosVolumen/{eventId}`
   para no contar dos veces un evento duplicado. Esos marcadores vencen a los 30 días
   (campo `expiraEn`), pero solo se borran con la política TTL del paso siguiente.

3. **Política TTL de los marcadores de eventos** (una sola vez; puede hacerse antes
   o después de desplegar la función). Sin ella los documentos de `eventosVolumen`
   se acumulan para siempre. La política se crea sobre el campo `expiraEn` del
   grupo de colecciones `eventosVolumen`:

   ```
   gcloud firestore fields ttls update expiraEn --collection-group=eventosVolumen --enable-ttl --project=stormcip-972bd
   ```

   Se necesita un rol que permita editar índices de Firestore (por ejemplo, Cloud
   Datastore Index Admin). La operación es asíncrona y los documentos vencidos se
   borran dentro de las 24 horas siguientes al vencimiento, no al instante. Para
   comprobar que quedó activa:

   ```
   gcloud firestore fields ttls list --project=stormcip-972bd
   ```

   Los emuladores no aplican TTL: ahí los marcadores no se borran.

4. **Hosting** (dashboard), con el build de producción de la sección siguiente.

   ```
   firebase deploy --project stormcip-972bd --only hosting
   ```

### Nota: duración de la demo y volumen circulado

La demo debe durar **~5 min o más** (el valor por defecto de `simulador-cip.js`). El
volumen circulado no cuenta el intervalo entre la última lectura de una etapa y la
primera de la siguiente, y esa pérdida es casi fija por etapa: con el ciclo de 300 s
el total queda ~2 % bajo el volumen exacto (1395,6 L de 1425 L), pero con ciclos de
60 s (`--duracion 60`), donde cada etapa dura apenas unos segundos, la pérdida sube a
~13 % (195,1 L de 225 L). Los ciclos cortos sirven para probar, no para mostrar cifras.

### Configuración de Firestore que el código nuevo espera (antes del paso 2)

El despliegue no cambia datos. Revisar la configuración de producción con el
script de solo lectura (no lee `apiKeyHash`; usa las credenciales de
`gcloud auth application-default login`):

```
cd scripts
node revisar-config-prod.js --prod --project stormcip-972bd
```

Lo que debe haber (valores de `seed-prod.js`; provisionales hasta confirmarlos con el cliente):

| Documento | Debe tener |
|---|---|
| `configuracion/umbrales` | `preenjuague` y `enjuague`: `ph` 5–11, `conductividad25C` máx 1500. `enjuague_final`: `ph` 6–8,5, `conductividad25C` máx 300. Sin umbrales de turbidez. |
| `configuracion/calculos` | `factorCompensacionEC` 0,02; `conductividadAguaRed` 150; `caudalNominalM3h` 18; `criterioLimpio` `{ conductividad25C: 200, turbidez: 10 }` (criterio de limpieza, distinto del umbral de alerta). |
| `dispositivos/<id del WQS-LB>` | `tipo: "wqs-lb"`, `activo: true`, `lineaId` de la línea con ciclo en curso, `firmware: "1.2"` (texto con una versión) y `sondas` activas `DR-PH01` + `DR-ECK1.0` (ninguna otra activa: ECK10.0, turbidez, DS18B20). |

El script imprime `FALTA` con el valor actual y el esperado de cada diferencia;
esos son los cambios exactos a hacer a mano en la consola.

### Build de Hosting con la configuración de producción

`web/.env.local` es la configuración de **desarrollo** (proyecto `stormcip-dev` y
`NEXT_PUBLIC_USE_EMULATORS=true`). Un `next build` con solo ese archivo dejaría el
sitio apuntando a los emuladores y al proyecto de desarrollo. **No editar
`web/.env.local`**: crear `web/.env.production.local`, que `next build` lee con
más prioridad (orden: `.env.production.local` → `.env.local` → `.env.production`
→ `.env`; el log del build lo confirma: "Environments: .env.production.local,
.env.local"). Está ignorado por git (`.env*`): cada máquina de build lo crea.

```
NEXT_PUBLIC_FB_API_KEY=<apiKey de la app web de stormcip-972bd>
NEXT_PUBLIC_FB_AUTH_DOMAIN=stormcip-972bd.firebaseapp.com
NEXT_PUBLIC_FB_PROJECT_ID=stormcip-972bd
NEXT_PUBLIC_FB_APP_ID=<appId de la app web de stormcip-972bd>
NEXT_PUBLIC_USE_EMULATORS=false
```

Los valores salen de la consola de Firebase (Configuración del proyecto → Tus
apps → Configuración del SDK). Construir y **verificar antes de desplegar**:

```
cd web
npm run build
cd ../scripts
node verificar-build-web.js
```

`verificar-build-web.js` lee `web/out` y falla (código 1) si encuentra `127.0.0.1`
(emuladores) o `stormcip-dev`, o si no aparece `stormcip-972bd`. Si falla, no
desplegar. Después de cualquier build local de desarrollo, `web/out` queda con la
configuración de desarrollo: volver a construir con producción antes de cada
deploy de Hosting. Si el build falla con `EBUSY` sobre `web/out`, algo tiene la
carpeta abierta (por ejemplo el emulador de Hosting): detenerlo y reintentar.

### Incidente (9 oct 2026): Hosting publicado con la configuración de desarrollo

**Qué pasó.** El sitio publicado dejó de permitir iniciar sesión. En la consola del navegador:
`POST http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key-for-emulators … net::ERR_CONNECTION_REFUSED`.
El JavaScript de esa versión (publicada el 9 oct a las 14:25 UTC) tenía `127.0.0.1` y
`stormcip-dev` y no tenía `stormcip-972bd`: se había construido con `web/.env.local`
(desarrollo, `NEXT_PUBLIC_USE_EMULATORS=true`). Cada visitante intentaba conectarse a los
emuladores de **su propio** computador, que no existen. No fue un cambio de código ni de
`firestore.rules`: el login falla antes de llegar a Firestore.

**Cómo se detectó.** Descargando las páginas y scripts públicos del sitio y buscando esas
cadenas (es lo que automatiza `scripts/verificar-build-web.js`), y mirando `Last-Modified`
(`curl -I https://stormcip-972bd.web.app/login`). El `Last-Modified` identifica qué
despliegue está sirviendo el sitio.

**Cómo se resolvió.** Consola de Firebase → Hosting → historial de versiones → "Revertir" a
la versión anterior (la del 1 oct, 22:14 UTC, que sí contenía `stormcip-972bd`). Sirve para
volver atrás en segundos sin reconstruir. Después hay que construir bien (sección anterior)
antes de volver a publicar.

**La caché del navegador puede seguir mostrando el error aunque el servidor ya esté bien.**
Hosting responde con `Cache-Control: max-age=3600`: el navegador puede reusar el script viejo
hasta una hora. Tras un despliegue o una reversión, probar con recarga forzada (Ctrl+Shift+R),
una ventana de incógnito, "Borrar datos del sitio" (F12 → Aplicación → Almacenamiento) o
desde otro dispositivo. Si la consola sigue nombrando el mismo archivo `.js` con
`127.0.0.1`, es la caché; si nombra otro, es otra causa.

**Al probar el login en producción** usar un usuario real de `stormcip-972bd` con rol (por
ejemplo el creado con `seed-prod.js`). `admin@stormcip.dev` / `admin123` solo existe en el
emulador.

**Para que no se repita, antes de cada `firebase deploy --only hosting`:**
1. Construir con `web/.env.production.local` (no con solo `.env.local`).
2. Correr `node verificar-build-web.js` (desde `scripts/`) y no desplegar si falla.
3. Avisar al equipo del despliegue: los usuarios pueden ver la versión anterior hasta una hora.
4. Si algo sale mal, revertir desde el historial de versiones de Hosting (consola) en vez de
   reconstruir con prisa.

## 4) Prueba de humo (no escribe nada en Firestore)

Antes de tocar la consola de TTS, probar la función ya desplegada
directamente. Los tres casos de abajo **no llegan a escribir una lectura**
(el primero falla la autenticación, el segundo se ignora por dispositivo
desconocido) — sirven para confirmar que la función responde antes de
enchufar TTS encima.

Reemplazar `<URL_TTNUPLINK>` por la URL copiada en el paso anterior. El
secreto real **no va en este documento** — pegarlo a mano solo al momento de
correr el comando, donde dice `<SECRETO_REAL>`.

### 4.1 — Secreto incorrecto → debe responder 401

**cmd:**
```
curl.exe -i -X POST "<URL_TTNUPLINK>" -H "Content-Type: application/json" -H "x-webhook-secret: esto-esta-mal" -d "{\"end_device_ids\":{\"device_id\":\"prueba-humo\",\"dev_eui\":\"0000000000000000\"},\"uplink_message\":{\"f_port\":2,\"frm_payload\":\"AAA=\"},\"received_at\":\"2026-01-01T00:00:00.000Z\"}"
```

**PowerShell** (`Invoke-RestMethod` lanza excepción en 4xx/5xx; el `catch` es
para poder ver el código de estado igual):
```powershell
$body = @{
  end_device_ids = @{ device_id = "prueba-humo"; dev_eui = "0000000000000000" }
  uplink_message = @{ f_port = 2; frm_payload = "AAA=" }
  received_at = "2026-01-01T00:00:00.000Z"
} | ConvertTo-Json -Depth 5

try {
  Invoke-RestMethod -Uri "<URL_TTNUPLINK>" -Method Post -Headers @{ "x-webhook-secret" = "esto-esta-mal" } -ContentType "application/json" -Body $body
} catch {
  "Status: $($_.Exception.Response.StatusCode.value__)"
}
```

Esperado: **401**, `{"error": "Secreto de webhook inválido o no configurado"}`.

### 4.2 — Secreto correcto, dispositivo inexistente → 200 ignorado

Mismo body, pero con el secreto real y un `device_id` que no existe en
Firestore (dejar `prueba-humo` tal cual, a propósito no corresponde a ningún
documento real).

**cmd:**
```
curl.exe -i -X POST "<URL_TTNUPLINK>" -H "Content-Type: application/json" -H "x-webhook-secret: <SECRETO_REAL>" -d "{\"end_device_ids\":{\"device_id\":\"prueba-humo\",\"dev_eui\":\"0000000000000000\"},\"uplink_message\":{\"f_port\":2,\"frm_payload\":\"AAA=\"},\"received_at\":\"2026-01-01T00:00:00.000Z\"}"
```

**PowerShell:**
```powershell
Invoke-RestMethod -Uri "<URL_TTNUPLINK>" -Method Post -Headers @{ "x-webhook-secret" = "<SECRETO_REAL>" } -ContentType "application/json" -Body $body
```

Esperado: **200**, `{"ok": true, "ignorado": true, "motivo": "dispositivo desconocido"}`.
Si en vez de eso da 401, el secreto configurado en el paso 2 no coincide con
el que se está mandando — revisar antes de seguir.

### 4.3 — Revisar los logs de la función

```
firebase functions:log --project stormcip-972bd --only ttnUplink
```

Deberían aparecer las dos llamadas de arriba. Este comando también sirve
después, para depurar el primer uplink real de un sensor físico.

## 5) Obtener la URL de `ttnUplink` para The Things Stack

El comando del paso 3 imprime, al terminar, la URL pública de cada función
desplegada. Copiarla directo de ahí (las URLs de Cloud Functions v2 no
siempre siguen un patrón fijo predecible, así que no hay que armarla a mano).
Esa URL es la que se configura en TTS: **Application → Integrations →
Webhooks → Add webhook**, con el header `x-webhook-secret` igual al valor
configurado en el paso 2.

⚠️ **El "End device ID" registrado en TTS debe ser idéntico al ID del
documento `dispositivos/{deviceId}` en Firestore, y el DevEUI configurado en
TTS debe coincidir con el campo `devEui` de ese documento.** `ttnUplink` usa
`end_device_ids.device_id` tal cual para buscar `dispositivos/{deviceId}`; si
no encuentra el documento, ignora el uplink con `"motivo": "dispositivo
desconocido"` (ver 4.2) — sin error visible en TTS, así que un typo acá se
nota recién revisando los logs (paso 4.3), no en la consola de TTS.

## 6) Cargar datos reales (sin `seed.js`)

`scripts/seed.js` **no se usa contra el proyecto real**: crea un usuario
admin con contraseña de prueba (`admin123`) y datos ficticios (planta
"frutillar", dispositivo `wqs-lb-01` con API key de prueba, etc.).

Para producción hay que crear a mano, con datos reales:
- `plantas/{plantaId}` y `plantas/{plantaId}/lineas/{lineaId}` de la planta real.
- `dispositivos/{deviceId}`: con el **DevEUI real** del equipo WQS-LB, su
  `firmware` real (revisar con `AT+VER` o el uplink de estado FPort=5), y las
  sondas físicamente conectadas.
- `ciclos/{cicloId}` del primer ciclo real a monitorear.
- `configuracion/umbrales` con los rangos de proceso reales, acordados con el
  cliente (no los de ejemplo del seed).
- Un usuario admin real (no `admin@stormcip.dev`/`admin123`).

Hay una plantilla guiada para esto en `scripts/produccion-plantilla.js` — ver
ese archivo para el detalle; no se ejecuta por accidente (se niega a correr
si quedan valores `<COMPLETAR>` sin completar).

⚠️ **Sin un ciclo con `estado: "en_curso"` en la línea del dispositivo, las
lecturas se ignoran sin error** (mismo mecanismo que el paso 4.2, pero por
`"motivo": "sin ciclo en curso en la línea"` en vez de dispositivo
desconocido — ver `resolverCicloActivo` en `lorawanAdapter.ts`). Para la
primera prueba con el sensor real: crear el ciclo activo (parte de esta
plantilla) **antes** de encender el equipo, no después.

⚠️ **Revisar el firmware antes de la primera prueba real.** El campo
`firmware` del documento `dispositivos/{deviceId}` debe reflejar la versión
real del equipo (confirmar con el uplink de estado FPort=5 o el comando
`AT+VER`, no adivinar). Si el equipo tiene firmware 1.3.x, el decoder
(`wqsDecoder.ts`) todavía no soporta ese formato — devuelve
`"formato no soportado"` para FPort=2 y la lectura se ignora igual que en los
casos anteriores, sin error visible del lado de TTS.

Para saberlo sin adivinar: `ttnUplink` procesa el uplink de estado (FPort 5,
al unirse a la red y cada 12 h) y guarda `firmwareReportado` en el dispositivo
sin tocar `firmware`. Si el firmware reportado es de otra familia de formato
que el registrado, el log de la función muestra `FIRMWARE INCOMPATIBLE` (ver
`firebase functions:log --project stormcip-972bd --only ttnUplink`). La
codificación de la versión (`0x0120` → `1.2.0`) es una suposición hasta el
primer FPort 5 real (ver `modelo-datos-sensores.md`, sección 5.4b).

## 7) Fuera de esta guía

- `firestore.rules` y `hosting` **no se despliegan con los pasos 1 a 4** — se
  coordinan aparte con el grupo antes de tocarlos; el orden y los comandos están
  en la sección 3.1.
- Configurar el webhook real en la consola de TTS requiere tener el
  dispositivo físico aprovisionado ahí primero (fuera del alcance de este
  documento).

## 8) Si algo sale mal

**TTS reporta 403 al intentar entregar el webhook** (distinto de que
`ttnUplink` responda 401/200 — un 403 significa que TTS ni siquiera pudo
invocar la función). Las funciones HTTP de Cloud Functions v2 corren sobre
Cloud Run, y necesitan el rol "Cloud Run Invoker" otorgado a `allUsers` para
aceptar peticiones públicas sin autenticar; normalmente `firebase deploy` lo
configura solo, pero una política de organización puede bloquearlo. Para
revisar (no ejecutar sin confirmar antes con el resto del equipo, puede
implicar exponer la función públicamente):
```
gcloud run services get-iam-policy ttnuplink --region=southamerica-west1 --project=stormcip-972bd
```
Si falta `allUsers` con rol `roles/run.invoker`, agregarlo con:
```
gcloud run services add-iam-policy-binding ttnuplink --region=southamerica-west1 --project=stormcip-972bd --member="allUsers" --role="roles/run.invoker"
```

**Ver logs** (de cualquier función, no solo para depurar el webhook):
```
firebase functions:log --project stormcip-972bd
```
o filtrado a una función puntual con `--only ttnUplink` (ver paso 4.3). Para
un historial más largo o filtros más finos, usar Cloud Console → Logging →
Logs Explorer del proyecto `stormcip-972bd`.

**Retirar o revertir una función desplegada:**
- Para sacarla de producción por completo:
  ```
  firebase functions:delete ttnUplink --project stormcip-972bd --region southamerica-west1
  ```
  (pide confirmación interactiva; nombrar la función explícita, nunca borrar "todo").
- Para volver a una versión anterior del código (más común que borrarla):
  hacer `git checkout` del commit anterior que funcionaba, y repetir el paso 3
  (`firebase deploy --project stormcip-972bd --only functions:ttnUplink`) con
  ese código — Cloud Functions no tiene un "deshacer" de un click desde el
  CLI de Firebase, así que redesplegar el código bueno es la forma más simple
  con las herramientas de este proyecto.

---

## Nota: proyecto "activo" por defecto distinto en esta máquina

En al menos una máquina de este equipo, el CLI de Firebase tiene guardado un
proyecto activo por defecto distinto al de `.firebaserc` (un ajuste local del
CLI, no algo del repo — no afecta a quien no lo tenga guardado). Antes de
depender de eso, verificar con `firebase use` (sin argumentos) qué proyecto
resolvería un comando sin `--project` explícito. Por eso todos los comandos
de este documento llevan `--project stormcip-972bd` a mano: no dependen de
cuál sea el proyecto activo por defecto en la máquina de quien despliegue.
