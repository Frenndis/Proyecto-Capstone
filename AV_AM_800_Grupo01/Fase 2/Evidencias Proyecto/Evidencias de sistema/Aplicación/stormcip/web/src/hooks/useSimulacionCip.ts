"use client";
import { useEffect, useState } from "react";
import {
  deriva, mockCycle, returnQuality, sensors as sensoresBase, type SensorKpi,
} from "@/lib/mock-cip";

/**
 * Telemetría simulada del mockup: los valores oscilan cada 2 s y el cronómetro
 * avanza cada segundo. El estado inicial es el de `mock-cip` (determinista) para
 * que el HTML exportado y la primera renderización del cliente coincidan.
 */
export function useSimulacionCip() {
  const [valores, setValores] = useState<SensorKpi[]>(sensoresBase);
  const [transcurrido, setTranscurrido] = useState(mockCycle.elapsedSeconds);
  const [conductividad, setConductividad] = useState(returnQuality.conductivity);
  const [historia, setHistoria] = useState<number[]>(returnQuality.history);

  useEffect(() => {
    const t = setInterval(() => setTranscurrido((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setValores((actuales) =>
        actuales.map((s, i) => ({
          ...s,
          value: deriva(sensoresBase[i].value, s.value, s.jitter, s.decimals),
        })));
      setConductividad((c) => deriva(returnQuality.conductivity, c, 0.3, 1));
    }, 2000);
    return () => clearInterval(t);
  }, []);

  // El histórico de turbidez avanza más lento: una muestra por minuto simulado.
  const turbidez = valores.find((s) => s.key === "turb")?.value ?? returnQuality.turbidity;
  useEffect(() => {
    const t = setInterval(() => {
      setHistoria((h) => [...h.slice(1), turbidez]);
    }, 10000);
    return () => clearInterval(t);
  }, [turbidez]);

  return { valores, transcurrido, turbidez, conductividad, historia };
}
