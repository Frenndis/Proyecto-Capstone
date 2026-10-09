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
| `cerrar-ciclo.js`, `recalcular.js`, `rotar-key.js`, `simulador-prod.js` | `--prod --project stormcip-972bd` (guardarraíles compartidos en `scripts/entorno.js`; además se niegan si encuentran `PROJECT_ID=stormcip-972bd` sin `--prod`) |
| `simulador-cip.js` | `--prod --project stormcip-972bd` |
| `seed-prod.js`, `produccion-plantilla.js` | `--project stormcip-972bd --confirmar` (solo producción; 5 s para cancelar) |
| `seed.js`, `simulador.js`, `simulador-ttn.js` | Nunca: solo emuladores |

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

Tres funciones corren en `southamerica-west1` (Santiago): `ttnUplink`,
`ingestLectura` y `setUserRole` — las tres son Cloud Functions 2ª
generación. `onUserCreated` corre en `southamerica-east1` (São Paulo): es
la única de 1ª generación (usa el trigger `auth.user().onCreate`, que no
existe en 2ª gen), y `southamerica-west1` no admite 1ª generación. Ver el
comentario junto a `onUserCreated` en `functions/src/auth.ts`.

⚠️ **Una función mal configurada puede tumbar el deploy de otras, aunque no
estén nombradas en el `--only`.** Las 4 funciones viven en un solo codebase
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
| `onUserCreated` | v1 (auth trigger) | `southamerica-east1` | Sí |

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

- `firestore.rules` y `hosting` **no se despliegan acá** — se coordinan
  aparte con el grupo antes de tocarlos.
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
