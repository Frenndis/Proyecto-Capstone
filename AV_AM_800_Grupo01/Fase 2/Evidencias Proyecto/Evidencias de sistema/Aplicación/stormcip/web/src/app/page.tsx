"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const router = useRouter();
  const { user, cargando } = useAuth();
  useEffect(() => {
    if (!cargando) router.replace(user ? "/monitoreo" : "/login");
  }, [cargando, user, router]);
  return <p className="p-6 text-slate-500">Cargando…</p>;
}
