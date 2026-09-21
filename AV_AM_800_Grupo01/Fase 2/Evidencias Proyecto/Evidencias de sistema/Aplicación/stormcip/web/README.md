# web (Next.js)
- Crear app aquí: `npx create-next-app@latest . --ts`
- En `next.config.js` usar `output: 'export'` → genera `web/out` (lo sirve Firebase Hosting).
- `npm i firebase` y usar `src/lib/firebase.ts`.
- `.env.local`: variables `NEXT_PUBLIC_FB_*` y `NEXT_PUBLIC_USE_EMULATORS=true`.
- Rol del usuario: `(await auth.currentUser.getIdTokenResult()).claims.rol`
