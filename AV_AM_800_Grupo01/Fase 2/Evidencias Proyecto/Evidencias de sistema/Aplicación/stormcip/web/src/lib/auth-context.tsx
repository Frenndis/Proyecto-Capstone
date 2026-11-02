"use client";
// Guarda el usuario y su rol para toda la app. El rol viene del token (custom claims).
import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth } from "./firebase";
import { Rol } from "./tipos";

type Estado = { user: User | null; rol: Rol | null; cargando: boolean; salir: () => Promise<void> };
const Ctx = createContext<Estado>({ user: null, rol: null, cargando: true, salir: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [rol, setRol] = useState<Rol | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u);
    if (u) {
      // true = refresca el token, para leer el rol recién asignado
      const { claims } = await u.getIdTokenResult(true);
      setRol((claims.rol as Rol) ?? null);
    } else setRol(null);
    setCargando(false);
  }), []);

  return (
    <Ctx.Provider value={{ user, rol, cargando, salir: () => signOut(auth) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
