"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const router = useRouter();
  const { user, cargando } = useAuth();
  useEffect(() => {
    if (!cargando) router.replace(user ? "/central" : "/login");
  }, [cargando, user, router]);
  return <p className="p-6 text-ink-3">Cargando…</p>;
}
