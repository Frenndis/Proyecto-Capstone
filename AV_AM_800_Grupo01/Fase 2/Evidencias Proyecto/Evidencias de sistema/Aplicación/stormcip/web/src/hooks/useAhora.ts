"use client";
import { useEffect, useState } from "react";

/** Hora actual en ms, refrescada cada `cadaMs`: para cronómetros que no vienen de Firestore. */
export function useAhora(cadaMs = 1000) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(id);
  }, [cadaMs]);
  return ahora;
}
