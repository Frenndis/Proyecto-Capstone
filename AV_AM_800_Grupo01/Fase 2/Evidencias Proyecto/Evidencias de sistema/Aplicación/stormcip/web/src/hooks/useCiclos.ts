"use client";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type ConfigCalculos = {
  conductividadAguaRed?: number; caudalNominalM3h?: number; metaAguaDiariaM3?: number;
  criterioLimpio?: { conductividad25C?: number; turbidez?: number };
};

export function useConfigCalculos() {
  const [cfg, setCfg] = useState<ConfigCalculos | null>(null);
  useEffect(() => onSnapshot(doc(db, "configuracion/calculos"), (s) => setCfg((s.data() ?? {}) as ConfigCalculos)), []);
  return cfg;
}
