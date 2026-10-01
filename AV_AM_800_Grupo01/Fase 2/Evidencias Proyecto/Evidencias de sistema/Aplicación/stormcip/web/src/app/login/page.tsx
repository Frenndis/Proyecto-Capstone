"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const entrar = async () => {
    setError(""); setCargando(true);
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      router.push("/dashboard");
    } catch (e: any) {
      setError(e.code === "auth/invalid-credential"
        ? "Correo o contraseña incorrectos." : "No se pudo iniciar sesión.");
    } finally { setCargando(false); }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 p-6 dark:border-slate-700">
        <div>
          <h1 className="text-xl font-semibold">StormCIP</h1>
          <p className="text-sm text-slate-500">Monitoreo de ciclos CIP</p>
        </div>
        <input type="email" placeholder="Correo" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:bg-slate-900" />
        <input type="password" placeholder="Contraseña" value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:bg-slate-900" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button onClick={entrar} disabled={cargando}
          className="w-full rounded-lg bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
          {cargando ? "Entrando…" : "Iniciar sesión"}
        </button>
      </div>
    </main>
  );
}
