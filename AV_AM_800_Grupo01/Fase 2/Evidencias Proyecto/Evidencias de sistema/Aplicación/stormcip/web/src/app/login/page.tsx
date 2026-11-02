"use client";
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setCargando(true);
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      router.push("/central");
    } catch (err: unknown) {
      setError((err as { code?: string }).code === "auth/invalid-credential"
        ? "Correo o contraseña incorrectos." : "No se pudo iniciar sesión. Revisa tu conexión e intenta de nuevo.");
    } finally { setCargando(false); }
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_440px]">
      <section className="hidden flex-col justify-between border-r border-line bg-sidebar p-10 lg:flex">
        <Image src="/logos/austral-chemicals-blanco.png" alt="Austral Chemicals" width={190} height={60}
          className="h-auto w-[190px]" priority />
        <div>
          <p className="sc-eyebrow mb-3">Storm CIP</p>
          <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight">
            Cada limpieza CIP, medida de principio a fin.
          </h1>
          <p className="mt-4 max-w-md text-[15px] text-ink-2">
            Temperatura, conductividad, pH y caudal de cada ciclo, en vivo y con su historial.
          </p>
        </div>
        <p className="font-mono text-[11px] text-ink-3">Austral Chemicals Chile</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <form onSubmit={entrar} className="w-full max-w-sm space-y-4">
          <Image src="/logos/austral-chemicals-blanco.png" alt="Austral Chemicals" width={160} height={50}
            className="mb-6 h-auto w-[160px] lg:hidden" />
          <div>
            <h2 className="text-[19px] font-bold tracking-tight">Iniciar sesión</h2>
            <p className="text-sm text-ink-3">Usa tu cuenta de planta.</p>
          </div>
          <label className="block">
            <span className="sc-eyebrow mb-1.5 block">Correo</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-ctrl border border-line-2 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="sc-eyebrow mb-1.5 block">Contraseña</span>
            <input type="password" required autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)}
              className="w-full rounded-ctrl border border-line-2 px-3 py-2 text-sm" />
          </label>
          {error && <p role="alert" className="text-sm text-crit">{error}</p>}
          <button type="submit" disabled={cargando} className="sc-btn w-full py-2">
            {cargando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
