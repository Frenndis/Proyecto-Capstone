"use client";
// Planes de limpieza CIP (circuito + receta) y límites de validación. Todos los ven;
// solo el administrador crea, modifica, desactiva o elimina.
import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { Ic } from "@/components/ui/Ic";
import { useConfigCalculos } from "@/hooks/useCiclos";
import {
  FaseForm, Plan, PlanForm, TIPOS_FASE, aFormulario, eliminarPlan, esQuimica, faseNueva, guardarPlan, planNuevo, usePlanes,
} from "@/hooks/usePlanes";
import { useAuth } from "@/lib/auth-context";
import { db } from "@/lib/firebase";
import { mmss, nf } from "@/lib/planta";

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const num = (s: string) => Number(s.replace(",", "."));

function Tarjeta({ p, admin, onEditar }: { p: Plan; admin: boolean; onEditar: () => void }) {
  const total = p.fases.reduce((a, f) => a + f.s, 0);
  const dias = DIAS.filter((_, i) => !p.libres.includes(i));
  return (
    <article className={`card pcard plan${p.activo ? "" : " is-off"}`}>
      <div className="plan-top">
        <div>
          <h3>{p.nombre}</h3>
          <p className="pcard__p" style={{ color: "var(--ink-3)" }}>{p.area} · {p.receta}{p.lead ? ` · ${p.lead}` : ""}</p>
          <p className="pcard__p mono" style={{ color: "var(--ink-3)", marginTop: 2 }}>
            {String(p.hora).padStart(2, "0")}:00 · {dias.length === 7 ? "todos los días" : dias.join(" ")}
            {!p.activo && <> · <span style={{ color: "var(--warn)" }}>desactivado</span></>}
          </p>
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <b className="mono" style={{ fontSize: 18, whiteSpace: "nowrap", display: "block" }}>{Math.round(total / 60)} min</b>
          {admin && <button className="btn2 btn2--s" style={{ marginTop: 6 }} onClick={onEditar}>Modificar</button>}
        </div>
      </div>
      <div className="plan-f">
        {p.fases.map((f) => (
          <div key={f.n} style={{ flex: f.s }}>
            <i style={{ background: f.c > 0.1 ? "#3E8FC7" : "#2A415E" }} />
            <b title={f.n}>{f.n}</b>
            <span className="mono">{mmss(f.s)}</span>
            <span className="mono">{f.t} °C{f.c > 0.1 ? ` · ${nf(f.c, 1)} %` : ""}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function Editor({ inicial, crear, onCerrar }: { inicial: PlanForm; crear: boolean; onCerrar: () => void }) {
  const [f, setF] = useState<PlanForm>(inicial);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const campo = (k: "nombre" | "corto" | "area" | "receta" | "lead" | "hora") => ({
    value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }),
  });
  const fase = (i: number, cambio: Partial<FaseForm>) => setF({ ...f, fases: f.fases.map((x, k) => (k === i ? { ...x, ...cambio } : x)) });
  const mover = (i: number, d: number) => {
    const fases = [...f.fases];
    [fases[i], fases[i + d]] = [fases[i + d], fases[i]];
    setF({ ...f, fases });
  };
  const libres = TIPOS_FASE.filter((t) => !f.fases.some((x) => x.n === t));
  const total = f.fases.reduce((a, x) => a + (Number.isFinite(num(x.min)) ? num(x.min) : 0), 0);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true); setError("");
    const err = await guardarPlan(f, crear);
    setOcupado(false);
    if (err) setError(err); else onCerrar();
  };
  const eliminar = async () => {
    setOcupado(true); setError("");
    const err = await eliminarPlan(f.id!);
    setOcupado(false);
    if (err) { setError(err); setConfirmar(false); } else onCerrar();
  };

  return (
    <form className="card pcard fm" onSubmit={guardar}>
      <div className="adm-h">
        <h2 className="fm__t">{crear ? "Nuevo plan de limpieza" : `Modificar: ${inicial.nombre}`}</h2>
        <span className="mono" style={{ color: "var(--ink-3)", fontSize: 12 }}>{f.fases.length} fases · {nf(total, 1)} min</span>
      </div>
      <div className="fm__g">
        <label>Nombre del circuito<input required maxLength={80} placeholder="Tina 3 · quesería" {...campo("nombre")} /></label>
        <label>Nombre corto<input maxLength={24} placeholder="Tina 3" {...campo("corto")} /></label>
        <label>Área<input required maxLength={40} placeholder="Quesería" {...campo("area")} /></label>
        <label>Receta<input required maxLength={60} placeholder="Quesería 2 fases" {...campo("receta")} /></label>
        <label style={{ gridColumn: "span 2" }}>Descripción<input maxLength={120} placeholder="Soda 1 % y ácido 0,5 % a 75 °C" {...campo("lead")} /></label>
        <label>Hora programada (0–23)<input type="number" min={0} max={23} required {...campo("hora")} /></label>
        <label>Estado
          <select value={f.activo ? "1" : "0"} onChange={(e) => setF({ ...f, activo: e.target.value === "1" })}>
            <option value="1">Activo</option><option value="0">Desactivado</option>
          </select>
        </label>
      </div>
      <div>
        <p className="kpi__l" style={{ marginBottom: 6 }}>Días con limpieza</p>
        <div className="dias">
          {DIAS.map((d, i) => (
            <button key={d} type="button" className={`chip${f.libres.includes(i) ? "" : " is-on"}`} aria-pressed={!f.libres.includes(i)}
              onClick={() => setF({ ...f, libres: f.libres.includes(i) ? f.libres.filter((x) => x !== i) : [...f.libres, i] })}>{d}</button>
          ))}
        </div>
      </div>
      <div className="adm-scroll">
        <table className="adm-t">
          <thead><tr><th>Fase</th><th>Duración, min</th><th>Temp. objetivo, °C</th><th>Concentración, %</th><th>Temp. mínima, °C</th><th>Caudal, m³/h</th><th /></tr></thead>
          <tbody>
            {f.fases.map((x, i) => (
              <tr key={x.n}>
                <td>
                  <select value={x.n} aria-label={`Tipo de la fase ${i + 1}`} onChange={(e) => fase(i, { ...faseNueva(e.target.value), min: x.min })}>
                    {[x.n, ...libres].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td><input className="n" inputMode="decimal" required aria-label={`Duración de ${x.n}`} value={x.min} onChange={(e) => fase(i, { min: e.target.value })} /></td>
                <td><input className="n" inputMode="decimal" required aria-label={`Temperatura de ${x.n}`} value={x.t} onChange={(e) => fase(i, { t: e.target.value })} /></td>
                <td><input className="n" inputMode="decimal" aria-label={`Concentración de ${x.n}`} disabled={!esQuimica(x.n)} required={esQuimica(x.n)} value={esQuimica(x.n) ? x.c : ""} placeholder={esQuimica(x.n) ? "" : "agua"} onChange={(e) => fase(i, { c: e.target.value })} /></td>
                <td><input className="n" inputMode="decimal" aria-label={`Temperatura mínima de ${x.n}`} value={x.tMin} placeholder="sin mínimo" onChange={(e) => fase(i, { tMin: e.target.value })} /></td>
                <td><input className="n" inputMode="decimal" aria-label={`Caudal de ${x.n}`} value={x.q} onChange={(e) => fase(i, { q: e.target.value })} /></td>
                <td>
                  <div className="acc">
                    <button type="button" className="btn2 btn2--s" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={`Subir ${x.n}`}>↑</button>
                    <button type="button" className="btn2 btn2--s" disabled={i === f.fases.length - 1} onClick={() => mover(i, 1)} aria-label={`Bajar ${x.n}`}>↓</button>
                    <button type="button" className="btn2 btn2--s" disabled={f.fases.length === 1} onClick={() => setF({ ...f, fases: f.fases.filter((_, k) => k !== i) })}>Quitar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {libres.length > 0 && (
        <div className="fm__a">
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Agregar fase:</span>
          {libres.map((t) => <button key={t} type="button" className="chip" onClick={() => setF({ ...f, fases: [...f.fases, faseNueva(t)] })}>+ {t}</button>)}
        </div>
      )}
      {error && <p className="fm__err" role="alert">{error}</p>}
      <div className="fm__a">
        <button className="btn2 btn2--pri" type="submit" disabled={ocupado}><Ic n="check" />{ocupado ? "Guardando…" : crear ? "Crear plan" : "Guardar cambios"}</button>
        <button className="btn2" type="button" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
        {!crear && (confirmar ? (
          <span className="fm__a" style={{ marginLeft: "auto" }}>
            <span style={{ fontSize: 12.5 }}>¿Eliminar este plan? No se puede deshacer.</span>
            <button className="btn2 btn2--crit" type="button" onClick={eliminar} disabled={ocupado}>Sí, eliminar</button>
            <button className="btn2" type="button" onClick={() => setConfirmar(false)}>No</button>
          </span>
        ) : <button className="btn2 btn2--crit" type="button" style={{ marginLeft: "auto" }} onClick={() => setConfirmar(true)} disabled={ocupado}>Eliminar plan</button>)}
      </div>
      <p className="pcard__p" style={{ color: "var(--ink-3)" }}>
        Los cambios rigen desde el próximo ciclo. Los ciclos ya registrados conservan la receta con la que corrieron.
      </p>
    </form>
  );
}

type Limites = { ecLimpio: string; ecRed: string; meta: string };

function LimitesValidacion({ admin }: { admin: boolean }) {
  const cfg = useConfigCalculos();
  const [editando, setEditando] = useState(false);
  const [f, setF] = useState<Limites>({ ecLimpio: "", ecRed: "", meta: "" });
  const [error, setError] = useState("");
  const ecLimpio = cfg?.criterioLimpio?.conductividad25C ?? 200, ecRed = cfg?.conductividadAguaRed ?? 150, meta = cfg?.metaAguaDiariaM3 ?? 26;
  const abrir = () => { setF({ ecLimpio: String(ecLimpio), ecRed: String(ecRed), meta: String(meta) }); setError(""); setEditando(true); };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const a = num(f.ecLimpio), b = num(f.ecRed), m = num(f.meta);
    if (![a, b, m].every((x) => Number.isFinite(x) && x > 0)) return setError("Los tres valores deben ser números mayores que cero.");
    if (a <= b) return setError("El criterio de agua limpia debe ser mayor que la conductividad del agua de red.");
    try {
      await setDoc(doc(db, "configuracion/calculos"), { conductividadAguaRed: b, metaAguaDiariaM3: m, criterioLimpio: { conductividad25C: a } }, { merge: true });
      setError(""); setEditando(false);
    } catch { setError("No se pudieron guardar los límites."); }
  };

  return (
    <aside className="card pcard">
      <p className="pcard__t">Límites de validación</p>
      {editando ? (
        <form className="fm" onSubmit={guardar}>
          <label>Agua limpia, µS/cm (máximo)<input inputMode="decimal" required value={f.ecLimpio} onChange={(e) => setF({ ...f, ecLimpio: e.target.value })} /></label>
          <label>Agua de red, µS/cm<input inputMode="decimal" required value={f.ecRed} onChange={(e) => setF({ ...f, ecRed: e.target.value })} /></label>
          <label>Meta de agua diaria, m³<input inputMode="decimal" required value={f.meta} onChange={(e) => setF({ ...f, meta: e.target.value })} /></label>
          {error && <p className="fm__err" role="alert">{error}</p>}
          <div className="fm__a">
            <button className="btn2 btn2--pri" type="submit">Guardar</button>
            <button className="btn2" type="button" onClick={() => { setEditando(false); setError(""); }}>Cancelar</button>
          </div>
        </form>
      ) : (
        <>
          <div className="evi">
            <div><span>Agua limpia</span><b className="mono">≤ {nf(ecLimpio)} µS/cm</b></div>
            <div><span>Agua de red</span><b className="mono">{nf(ecRed)} µS/cm</b></div>
            <div><span>Velocidad mínima</span><b className="mono">1,5 m/s</b></div>
            <div><span>Meta de agua diaria</span><b className="mono">{nf(meta)} m³</b></div>
          </div>
          {admin && <button className="btn2" style={{ marginTop: 12 }} onClick={abrir}>Modificar límites</button>}
          <p className="pcard__p" style={{ marginTop: 12, color: "var(--ink-3)" }}>
            Cada fase valida además su temperatura mínima, la concentración entre 85 % y 120 % del objetivo y el caudal sobre 80 % del nominal.
          </p>
        </>
      )}
    </aside>
  );
}

export default function ConfiguracionPage() {
  const { planes, cargando } = usePlanes();
  const { rol } = useAuth();
  const admin = rol === "admin";
  const [edicion, setEdicion] = useState<{ form: PlanForm; crear: boolean } | null>(null);
  const activos = planes.filter((p) => p.activo).length;

  return (
    <section className="v v-adm v-adm--2">
      <div className="adm-col">
        <div className="adm-h">
          <p>
            {cargando ? "Leyendo planes…" : `${planes.length} planes de limpieza · ${activos} activos.`}
            {!admin && " Solo un administrador puede crear o modificar planes."}
          </p>
          {admin && !edicion && <button className="btn2 btn2--pri" onClick={() => setEdicion({ form: planNuevo(), crear: true })}>+ Nuevo plan</button>}
        </div>
        {edicion && <Editor key={edicion.form.id ?? "nuevo"} inicial={edicion.form} crear={edicion.crear} onCerrar={() => setEdicion(null)} />}
        <div className="planes">
          {planes.map((p) => (
            <Tarjeta key={p.id} p={p} admin={admin && edicion?.form.id !== p.id}
              onEditar={() => { setEdicion({ form: aFormulario(p), crear: false }); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
          ))}
        </div>
      </div>
      <LimitesValidacion admin={admin} />
    </section>
  );
}
