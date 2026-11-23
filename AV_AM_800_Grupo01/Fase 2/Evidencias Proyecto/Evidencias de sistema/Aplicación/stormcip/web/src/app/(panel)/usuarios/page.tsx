"use client";
// Administración de usuarios: alta, cambio de rol, activar o desactivar y restablecer
// contraseña. Solo administradores; las funciones del servidor lo vuelven a comprobar.
import { useCallback, useEffect, useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import GuardRol from "@/components/layout/GuardRol";
import { useAuth } from "@/lib/auth-context";
import { auth, functions } from "@/lib/firebase";
import type { Rol } from "@/lib/tipos";

type Usuario = {
  uid: string; email: string | null; nombre: string | null; rol: Rol | null;
  activo: boolean; creadoMs: number | null; ultimoIngresoMs: number | null;
};
const ROLES: [Rol, string, string][] = [
  ["admin", "Administrador", "Gestiona usuarios, planes y límites"],
  ["operador", "Operador", "Inicia y detiene ciclos"],
  ["visor", "Visor", "Solo consulta"],
];
const fecha = (ms: number | null) => (ms ? new Date(ms).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "nunca");
const textoError = (e: unknown, defecto: string) => {
  const m = e as { message?: string; code?: string };
  return m.code === "functions/internal" || !m.message ? defecto : m.message.replace(/\s*\[\d{3}\]$/, "");
};

function Alta({ onCreado }: { onCreado: (email: string) => void }) {
  const vacio = { email: "", nombre: "", rol: "operador" as Rol, password: "" };
  const [f, setF] = useState(vacio);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true); setError("");
    try {
      await httpsCallable(functions, "crearUsuario")(f);
      onCreado(f.email);
      setF(vacio);
    } catch (err) { setError(textoError(err, "No se pudo crear el usuario.")); }
    finally { setOcupado(false); }
  };
  return (
    <form className="card pcard fm" onSubmit={crear}>
      <p className="pcard__t" style={{ margin: 0 }}>Nuevo usuario</p>
      <label>Correo<input type="email" required autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label>Nombre<input maxLength={80} autoComplete="off" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
      <label>Rol
        <select value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value as Rol })}>
          {ROLES.map(([id, n, d]) => <option key={id} value={id}>{n} · {d}</option>)}
        </select>
      </label>
      <label>Contraseña temporal (mínimo 8)
        <input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </label>
      {error && <p className="fm__err" role="alert">{error}</p>}
      <button className="btn2 btn2--pri" type="submit" disabled={ocupado}>{ocupado ? "Creando…" : "Crear usuario"}</button>
      <p className="pcard__p" style={{ color: "var(--ink-3)" }}>Entrega la contraseña temporal por un canal seguro, o usa «Restablecer» para que la persona defina la suya por correo.</p>
    </form>
  );
}

function Usuarios() {
  const { user } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(() => httpsCallable(functions, "listarUsuarios")().then(
    (r) => setUsuarios((r.data as { usuarios: Usuario[] }).usuarios),
    (e) => { setError(textoError(e, "No se pudo leer la lista de usuarios.")); setUsuarios((u) => u ?? []); },
  ), []);
  useEffect(() => { void cargar(); }, [cargar]);

  const accion = async (uid: string, hacer: () => Promise<unknown>, hecho: string) => {
    setOcupado(uid); setError(""); setAviso("");
    try { await hacer(); setAviso(hecho); await cargar(); }
    catch (e) { setError(textoError(e, "No se pudo completar la acción.")); }
    finally { setOcupado(null); }
  };
  const cambiarRol = (u: Usuario, rol: Rol) => accion(u.uid, async () => {
    await httpsCallable(functions, "setUserRole")({ uid: u.uid, rol });
    // Si es la propia cuenta, el token debe refrescarse para tomar el rol nuevo
    if (u.uid === user?.uid) await user.getIdToken(true);
  }, `${u.email} ahora es ${ROLES.find(([id]) => id === rol)?.[1].toLowerCase()}. El cambio rige cuando vuelva a iniciar sesión o en menos de una hora.`);
  const activar = (u: Usuario, activo: boolean) => accion(u.uid, () => httpsCallable(functions, "setUserActivo")({ uid: u.uid, activo }),
    activo ? `${u.email} puede volver a entrar.` : `${u.email} quedó desactivado y se cerraron sus sesiones.`);
  const restablecer = (u: Usuario) => accion(u.uid, () => sendPasswordResetEmail(auth, u.email!), `Se envió a ${u.email} un correo para definir su contraseña.`);

  const lista = usuarios ?? [];
  return (
    <section className="v v-adm v-adm--2">
      <div className="adm-col">
        <div className="adm-h">
          <p>{usuarios === null ? "Leyendo usuarios…" : `${lista.length} cuentas · ${lista.filter((u) => u.rol === "admin" && u.activo).length} administradores activos.`}</p>
        </div>
        {error && <p className="fm__err" role="alert">{error}</p>}
        {aviso && <p className="fm__ok" role="status">{aviso}</p>}
        <div className="card adm-scroll">
          <table className="adm-t">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último ingreso</th><th /></tr></thead>
            <tbody>
              {lista.map((u) => {
                const yo = u.uid === user?.uid;
                return (
                  <tr key={u.uid} className={u.activo ? "" : "is-off"}>
                    <td><b>{u.nombre || u.email}{yo ? " (tú)" : ""}</b><small>{u.email}</small></td>
                    <td>
                      <select value={u.rol ?? ""} disabled={ocupado === u.uid} aria-label={`Rol de ${u.email}`}
                        onChange={(e) => cambiarRol(u, e.target.value as Rol)} style={{ minWidth: 130 }}>
                        {!u.rol && <option value="">Sin rol</option>}
                        {ROLES.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                      </select>
                    </td>
                    <td><span className={`st st--${u.activo ? "ok" : "none"}`}><i />{u.activo ? "Activo" : "Desactivado"}</span></td>
                    <td className="mono">{fecha(u.ultimoIngresoMs)}</td>
                    <td>
                      <div className="acc">
                        <button className="btn2 btn2--s" disabled={ocupado === u.uid || !u.email} onClick={() => restablecer(u)}>Restablecer</button>
                        <button className={`btn2 btn2--s${u.activo ? " btn2--crit" : ""}`} disabled={ocupado === u.uid || yo} title={yo ? "No puedes desactivar tu propia cuenta" : undefined}
                          onClick={() => activar(u, !u.activo)}>{u.activo ? "Desactivar" : "Activar"}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {usuarios !== null && lista.length === 0 && <tr><td colSpan={5} style={{ color: "var(--ink-3)" }}>No hay usuarios que mostrar.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="adm-col">
        <Alta onCreado={(email) => { setAviso(`Se creó la cuenta ${email}.`); setError(""); void cargar(); }} />
        <section className="card pcard">
          <p className="pcard__t">Qué puede hacer cada rol</p>
          <div className="evi">
            {ROLES.map(([id, n, d]) => <div key={id}><span>{n}</span><b style={{ fontWeight: 500, fontSize: 12.5, textAlign: "right" }}>{d}</b></div>)}
          </div>
        </section>
      </div>
    </section>
  );
}

export default function UsuariosPage() {
  return <GuardRol roles={["admin"]}><Usuarios /></GuardRol>;
}
