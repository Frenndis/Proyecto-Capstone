# Dashboard StormCIP (Next.js + React)

## 1. Crear la app (solo la primera vez)
```powershell
cd C:\Users\Quilateo\Desktop\capstone\sprint1\stormcip\web
npx create-next-app@latest . --ts
```
Responder: TypeScript **Yes** · ESLint **Yes** · Tailwind **Yes** · `src/` **Yes** · App Router **Yes** · Turbopack **No** · alias `@/*` **Yes**

```powershell
npm install firebase recharts
```

## 2. Copiar estos archivos
Pegar el contenido de esta carpeta dentro de `web/`, reemplazando `src/app/page.tsx`,
`src/app/layout.tsx` y `next.config.js` (borrar `next.config.ts` si create-next-app lo creó).

## 3. Credenciales
Copiar `.env.local.example` como `.env.local` y rellenar `API_KEY` y `APP_ID`
desde la consola de Firebase (⚙️ Configuración del proyecto → General → Tus apps).

## 4. Correr (3 terminales)
```powershell
firebase emulators:start                      # 1 - raíz del proyecto
cd scripts; npm run seed; npm run sim         # 2 - datos + simulador
cd web; npm run dev                           # 3 - dashboard
```
Abrir http://localhost:3000 y entrar con `admin@stormcip.dev` / `admin123`.

## 5. Publicar en Hosting (cuando esté listo)
```powershell
cd web; npm run build      # genera web/out
cd ..; firebase deploy --only hosting
```

## Qué hace cada archivo
| Archivo | Rol |
|---|---|
| `src/lib/firebase.ts` | Conexión única a Auth, Firestore y Functions. Detecta emuladores. |
| `src/lib/auth-context.tsx` | Guarda usuario y rol (custom claims) para toda la app. |
| `src/hooks/useDatosCip.ts` | `onSnapshot` en tiempo real: ciclo activo, lecturas, alertas, umbrales. |
| `src/components/*` | Tarjetas de variables, gráfico de tendencia, panel de alertas. |
| `src/app/login` | Inicio de sesión con correo y contraseña. |
| `src/app/dashboard` | Pantalla principal. Redirige a /login si no hay sesión. |

## Notas
- Todo componente que use Firebase lleva `"use client"` arriba.
- El rol se refresca con `getIdTokenResult(true)`; si cambian un rol, hay que volver a entrar.
- Reconocer alertas solo funciona con rol admin u operador (lo imponen las reglas de Firestore).
