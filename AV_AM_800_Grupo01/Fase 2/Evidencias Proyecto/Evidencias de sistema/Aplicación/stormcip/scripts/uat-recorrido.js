// Recorrido de aceptación (UAT) automatizado de la web contra los EMULADORES.
// Abre Edge o Chrome sin ventana, recorre las pantallas con los tres roles, comprueba
// los criterios de aceptación de las historias de usuario y guarda una captura de cada
// paso. No usa dependencias: habla con el navegador por el protocolo DevTools.
//
// Antes: emuladores levantados, `npm run seed`, `node sembrar-planta.js` y la web en
// http://localhost:3000 (`npm run dev` en web/, con .env.development.local de emuladores).
//
// Uso, desde scripts/:
//   node uat-recorrido.js <carpeta-de-capturas>
// Sale con código 1 si algún criterio falla. Las contraseñas de las cuentas de prueba
// se generan al azar en cada corrida y no se imprimen.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const BASE = process.env.UAT_URL || "http://localhost:3000";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error("uat-recorrido.js es solo para la web local con emuladores."); process.exit(1); }
const salida = process.argv[2];
if (!salida) { console.error("Uso: node uat-recorrido.js <carpeta-de-capturas>"); process.exit(1); }
fs.mkdirSync(salida, { recursive: true });

const NAVEGADORES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const exe = process.env.UAT_NAVEGADOR || NAVEGADORES.find((p) => fs.existsSync(p));
if (!exe) { console.error("No se encontró Edge ni Chrome. Indica la ruta en UAT_NAVEGADOR."); process.exit(1); }

const PUERTO = 9333;
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "uat-stormcip-"));
const nav = spawn(exe, ["--headless=new", `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfil}`, "--window-size=1440,900",
  "--hide-scrollbars", "--no-first-run", "--disable-extensions", "about:blank"], { stdio: "ignore" });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, sig = 0;
const pendientes = new Map();
const cdp = (method, params = {}) => new Promise((ok, mal) => {
  const id = ++sig;
  pendientes.set(id, { ok, mal });
  ws.send(JSON.stringify({ id, method, params }));
});
async function conectar() {
  for (let i = 0; i < 40; i++) {
    try {
      const pags = await (await fetch(`http://127.0.0.1:${PUERTO}/json`)).json();
      const p = pags.find((x) => x.type === "page");
      if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
    } catch { /* aún no abre */ }
    await espera(250);
  }
  if (!ws) throw new Error("El navegador no abrió el puerto de depuración");
  await new Promise((ok, mal) => { ws.onopen = ok; ws.onerror = () => mal(new Error("No se pudo conectar al navegador")); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = pendientes.get(m.id);
    if (!p) return;
    pendientes.delete(m.id);
    m.error ? p.mal(new Error(m.error.message)) : p.ok(m.result);
  };
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
}

const js = async (expr) => {
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const ir = async (ruta, ms = 2500) => { await cdp("Page.navigate", { url: BASE + ruta }); await espera(ms); };
const texto = () => js("document.body.innerText");
async function hasta(expr, ms = 15000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await js(`!!(${expr})`)) return true; await espera(300); }
  return false;
}
const hastaTexto = (t, ms) => hasta(`document.body.innerText.includes(${JSON.stringify(t)})`, ms);
/** Escribe en un campo (lo deja enfocado y con todo seleccionado; insertText lo reemplaza). */
async function escribir(selector, valor, n = 0) {
  const ok = await js(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${n}]; if (!e) return false; e.focus(); e.select?.(); return true; })()`);
  if (!ok) throw new Error(`No existe el campo ${selector}[${n}]`);
  await cdp("Input.insertText", { text: valor });
}
/** Cambia un <select> como lo haría la persona (React escucha el evento change). */
const elegir = (selector, valor, n = 0) => js(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${n}]; if (!e) return false;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(valor)}); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
const clic = (selector, contiene = "") => js(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.innerText.includes(${JSON.stringify(contiene)})); if (!e) return false; e.click(); return true; })()`);
async function captura(nombre) {
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(salida, `${nombre}.png`), Buffer.from(data, "base64"));
}

const resultados = [];
function caso(id, descripcion, pasa, detalle = "") {
  resultados.push({ id, pasa });
  console.log(`${pasa ? "PASA " : "FALLA"} ${id} · ${descripcion}${detalle ? ` · ${detalle}` : ""}`);
}

async function entrar(email, password) {
  await ir("/login", 2000);
  await escribir('input[type="email"]', email);
  await escribir('input[type="password"]', password);
  await clic('button[type="submit"]');
  return hasta('location.pathname.startsWith("/central")', 15000);
}
async function salir() {
  await clic(".sb__salir");
  await hasta('location.pathname.startsWith("/login")', 8000);
}
const clave = () => crypto.randomBytes(9).toString("base64url");

(async () => {
  await conectar();
  console.log(`# Recorrido UAT · ${new Date().toLocaleString("es-CL")} · ${BASE} (emuladores de Firebase) · ${path.basename(exe)}`);

  // ---------- Sin sesión ----------
  await ir("/dashboard", 3500);
  caso("UAT-01", "HU-08 · sin sesión, /dashboard lleva al inicio de sesión", await js('location.pathname.startsWith("/login")'));
  await captura("01-inicio-de-sesion");
  await escribir('input[type="email"]', "admin@stormcip.dev");
  await escribir('input[type="password"]', "clave-incorrecta");
  await clic('button[type="submit"]');
  await hasta('document.querySelector("[role=alert]")', 8000);
  const errorLogin = await js('document.querySelector("[role=alert]")?.innerText ?? ""');
  caso("UAT-02", "HU-08 · contraseña incorrecta muestra un error y no entra", errorLogin !== "" && await js('location.pathname.startsWith("/login")'), `mensaje: «${errorLogin}»`);

  // ---------- Administrador ----------
  caso("UAT-03", "HU-08 · el administrador inicia sesión y llega a Central CIP", await entrar("admin@stormcip.dev", "admin123"));
  await hastaTexto("Limpiezas de hoy"); await espera(3500);
  const central = await texto();
  caso("UAT-04", "Central CIP muestra los ciclos de hoy y el plano de circuitos", /Ciclos hoy/i.test(central) && central.includes("Circuitos conectados a la central"));
  await captura("02-central-cip");

  // Ciclo en vivo: gráfico por variables y periodo (HU-04)
  await ir("/dashboard?circuito=and2", 4000);
  await hasta('document.querySelector(".gp svg")');
  await js('localStorage.removeItem("stormcip.grafico")');
  caso("UAT-05", "HU-04 · el gráfico ofrece elegir variables (6) y periodo (5)",
    await js('document.querySelectorAll(".gp__vars .chip").length === 6 && document.querySelector(".gp__ctrl select").options.length === 5'));
  await clic(".gp__vars .chip", "Conductividad");
  const carriles = await js('document.querySelectorAll(".gp svg .lv-lane").length');
  caso("UAT-06", "HU-04 · al agregar Conductividad aparece su carril en el gráfico", carriles === 4, `${carriles} carriles`);
  await elegir(".gp__ctrl select", "7d");
  await hasta('/\\d+ ciclos ·/.test(document.querySelector(".gp__n")?.innerText ?? "")', 15000); await espera(800);
  const n7 = await js('document.querySelector(".gp__n").innerText');
  const ciclos7 = Number(/(\d+) ciclos/.exec(n7)?.[1] ?? 0);
  caso("UAT-07", "HU-04 · con «Últimos 7 días» se dibujan las lecturas de todos los ciclos del periodo", ciclos7 >= 5 && (await js('document.querySelectorAll(".gp svg polyline.gp-l").length')) === ciclos7 * 4, n7);
  // Cursor sobre el gráfico: detalle de la lectura
  const caja = await js('(() => { const r = document.querySelector(".gp svg").getBoundingClientRect(); return { x: r.left + r.width * 0.42, y: r.top + r.height * 0.3 }; })()');
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: caja.x, y: caja.y });
  await espera(500);
  caso("UAT-08", "HU-04 · al pasar el cursor se ve ciclo, fase y valor de cada variable", await js('!!document.querySelector(".gp__tip") && document.querySelectorAll(".gp__tip .gp__fila").length === 4'));
  await captura("04-grafico-por-periodo");
  await elegir(".gp__ctrl select", "30d");
  await elegir(".gp__ctrl select", "todos", 1);
  await hasta('Number(/(\\d+) ciclos/.exec(document.querySelector(".gp__n")?.innerText ?? "")?.[1] ?? 0) > 100', 20000);
  const n30 = await js('document.querySelector(".gp__n").innerText');
  caso("UAT-09", "HU-04 · «Últimos 30 días» con todos los circuitos carga más de 100 ciclos", /\d{3,} ciclos/.test(n30.replace(".", "")), n30);
  await elegir(".gp__ctrl select", "ciclo");
  await clic(".gp__vars .chip", "Conductividad");

  // Ciclo de demostración con caída de temperatura (HU-02, HU-03, HU-07, HU-11)
  await elegir(".lv-ctrl select", "and2", 0);
  await elegir(".lv-ctrl select", "desvio", 1);
  await clic(".lv-ctrl .btn2--pri");
  caso("UAT-10", "HU-11 · un operador o admin inicia un ciclo de demostración desde el dashboard", await hastaTexto("Ciclo en curso en", 20000));
  await hasta('document.querySelectorAll(".pry .conf").length >= 1', 15000);
  caso("UAT-11", "HU-07 · el dashboard muestra una proyección en minutos con su nivel de confianza",
    await js('/min/.test(document.querySelector(".pry__c b")?.innerText ?? "") && /confianza \\d+ %/.test(document.querySelector(".pry .conf")?.innerText ?? "")'),
    await js('`${document.querySelector(".pry__c b")?.innerText} · ${document.querySelector(".pry .conf")?.innerText.replace(/\\s+/g, " ")}`'));
  caso("UAT-12", "HU-02 · la barra de fases marca la fase en curso y el reloj avanza", await js('!!document.querySelector(".ph button.is-on") && /\\d\\d:\\d\\d/.test(document.querySelector(".lv-clock b").innerText)'));
  const AVISO_TIENDE = '[...document.querySelectorAll(".avs .av--warn")].map((e) => e.innerText.replace(/\\s+/g, " ")).find((t) => t.includes("tiende")) ?? ""';
  await hasta(`(${AVISO_TIENDE}) !== ""`, 60000);
  const avisoTiende = await js(AVISO_TIENDE);
  caso("UAT-13", "HU-07 · se avisa cuando una variable tiende a salir de su rango, con su confianza", /tiende a bajar del mínimo/.test(avisoTiende) && /confianza \d+ %/.test(avisoTiende), avisoTiende);
  caso("UAT-14", "HU-03 · al salir del rango queda el aviso «fuera de rango» con valor y límite", await hastaTexto("Temperatura fuera de rango", 20000));
  await hastaTexto("volvió a su rango", 30000); await espera(1200);
  await captura("03-ciclo-en-vivo");
  // La proyección de agua limpia dura pocos segundos reales a 20×: se sondea seguido
  let proyeccionLimpio = "";
  for (const fin = Date.now() + 100000; Date.now() < fin && !proyeccionLimpio;) {
    const t = await js('[...document.querySelectorAll(".pry__c")][1]?.innerText.replace(/\\s+/g, " ") ?? ""');
    if (/enjuague final/.test(t) && /min/.test(t) && /confianza \d+ %/.test(t)) { proyeccionLimpio = t; await captura("03b-proyeccion-agua-limpia"); }
    else await espera(200);
  }
  caso("UAT-15", "HU-07 · en el enjuague final se proyecta en minutos cuándo llega a agua limpia", proyeccionLimpio !== "", proyeccionLimpio.slice(0, 110));
  const cerro = await hastaTexto("Con desvío", 90000) && await hasta('!document.body.innerText.includes("Ciclo en curso en")', 60000);
  caso("UAT-16", "HU-06 · al cerrar, el ciclo queda «Con desvío» y emite su registro", cerro && /Registro CIP-\d+ emitido/.test(await texto()));

  await ir("/registros", 5000);
  const reg = await texto();
  caso("UAT-17", "HU-06 · el registro del ciclo muestra cumplimiento por fase, agua limpia y consumos", reg.includes("Registro de limpieza CIP".toUpperCase()) || /Registro de limpieza CIP/i.test(reg) && /Liberaci[oó]n del circuito/i.test(reg) && /Consumo de este ciclo/i.test(reg));
  await captura("05-registros-de-ciclo");
  await ir("/consumos", 5500);
  const cons = await texto();
  caso("UAT-18", "HU-05 · Consumos muestra agua y químico de los últimos 30 días y por circuito", /Agua de CIP · 30 días/i.test(cons) && /Químico · 30 días/i.test(cons) && /Agua por circuito/i.test(cons));
  await captura("06-consumos");
  await ir("/prediccion", 5500);
  const pred = await texto();
  caso("UAT-19", "HU-07 · Predicción lista decisiones con ahorro y el desempeño de los modelos", /Modelos de machine learning/i.test(pred) && /Para ahorrar/i.test(pred));
  await captura("07-prediccion-y-ahorro");
  await ir("/reportes", 5500);
  caso("UAT-20", "Reportes entrega el resumen para gerencia de los últimos 30 días", /Resumen para gerencia/i.test(await texto()));
  await captura("08-reportes");
  await ir("/sensores", 4500);
  caso("UAT-21", "HU-01/HU-10 · Sensores WQS-LB abre la vista de la línea piloto", /sondas WQS-LB/i.test(await texto()));
  await captura("09-sensores");

  // Planes de limpieza
  await ir("/configuracion", 4000);
  await hastaTexto("planes de limpieza ·");
  caso("UAT-22", "Planes · se listan los 8 planes de fábrica y los límites de validación", /8 planes de limpieza/.test(await texto()) && /Límites de validación/i.test(await texto()));
  await captura("10-planes-de-limpieza");
  await clic(".adm-h .btn2--pri");
  await hasta('document.querySelector("form.fm")');
  await escribir('form.fm input[placeholder="Tina 3 · quesería"]', "Tina 3 · quesería");
  await escribir('form.fm input[placeholder="Quesería"]', "Quesería");
  await escribir('form.fm input[placeholder="Quesería 2 fases"]', "Quesería corta");
  await escribir('form.fm input[aria-label="Temperatura mínima de Soda"]', "80");
  await captura("11-nuevo-plan");
  await clic('form.fm button[type="submit"]');
  caso("UAT-23", "Planes · el servidor rechaza un plan inválido (mínimo sobre el objetivo) y explica por qué", await hastaTexto("la temperatura mínima no puede superar el objetivo", 10000));
  await escribir('form.fm input[aria-label="Temperatura mínima de Soda"]', "65");
  await clic('form.fm button[type="submit"]');
  caso("UAT-24", "Planes · el administrador crea un plan nuevo y aparece en la lista", await hastaTexto("9 planes de limpieza", 12000));
  await clic(".plan .btn2", "Modificar");
  await js('[...document.querySelectorAll(".plan")].find((p) => p.innerText.includes("Tina 3 · quesería")).querySelector(".btn2").click()');
  await hastaTexto("Modificar: Tina 3 · quesería", 5000);
  await escribir('form.fm input[aria-label="Duración de Soda"]', "8");
  await clic('form.fm button[type="submit"]');
  caso("UAT-25", "Planes · el administrador modifica un plan y el cambio queda guardado (25 → 28 min)",
    await hasta('[...document.querySelectorAll(".plan")].some((p) => p.innerText.includes("Tina 3 · quesería") && p.innerText.includes("28 min")) && !document.querySelector("form.fm")', 12000));
  await clic(".card.pcard .btn2", "Modificar límites");
  await hasta('document.querySelector("aside form.fm")');
  await escribir("aside form.fm input", "100", 0);
  await clic('aside form.fm button[type="submit"]');
  caso("UAT-26", "Límites · no se acepta un criterio de agua limpia menor que el agua de red", await hastaTexto("debe ser mayor que la conductividad del agua de red", 6000));
  await clic("aside form.fm .btn2", "Cancelar");

  // Usuarios
  const cuentas = { operador: { email: "uat.operador@stormcip.dev", clave: clave() }, visor: { email: "uat.visor@stormcip.dev", clave: clave() } };
  await ir("/usuarios", 4000);
  await hastaTexto("administradores activos");
  for (const [rol, c] of Object.entries(cuentas)) {
    await escribir('form.fm input[type="email"]', c.email);
    await escribir('form.fm input:not([type])', `UAT ${rol}`);
    await elegir("form.fm select", rol);
    await escribir('form.fm input[type="password"]', c.clave);
    await clic('form.fm button[type="submit"]');
    await hastaTexto(`Se creó la cuenta ${c.email}`, 15000);
  }
  await espera(1500);
  const filas = await js('[...document.querySelectorAll(".adm-t tbody tr")].map((f) => `${f.querySelector("small")?.innerText}=${f.querySelector("select")?.value}`)');
  caso("UAT-27", "HU-09 · el administrador crea cuentas con su rol (operador y visor)", filas.includes(`${cuentas.operador.email}=operador`) && filas.includes(`${cuentas.visor.email}=visor`), `${filas.length} cuentas`);
  await captura("12-usuarios");
  // Cambio de rol y vuelta atrás
  const filaVisor = `[...document.querySelectorAll(".adm-t tbody tr")].find((f) => f.innerText.includes(${JSON.stringify(cuentas.visor.email)}))`;
  await js(`(() => { const s = ${filaVisor}.querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "operador"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  const cambio = await hastaTexto("ahora es operador", 12000);
  await js(`(() => { const s = ${filaVisor}.querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "visor"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  caso("UAT-28", "HU-09 · el administrador cambia el rol de un usuario", cambio && await hastaTexto("ahora es visor", 12000));
  const filaAdmin = '[...document.querySelectorAll(".adm-t tbody tr")].find((f) => f.innerText.includes("admin@stormcip.dev"))';
  await js(`(() => { const s = ${filaAdmin}.querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "visor"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  caso("UAT-29", "HU-09 · no se puede dejar la planta sin administrador (único admin)", await hastaTexto("Es el único administrador activo", 12000));
  const filaOper = `[...document.querySelectorAll(".adm-t tbody tr")].find((f) => f.innerText.includes(${JSON.stringify(cuentas.operador.email)}))`;
  await js(`${filaOper}.querySelector(".acc .btn2--crit").click()`);
  const desact = await hastaTexto("quedó desactivado", 12000);
  await js(`[...${filaOper}.querySelectorAll(".acc .btn2")].find((b) => b.innerText === "Activar").click()`);
  caso("UAT-30", "Usuarios · el administrador desactiva y reactiva una cuenta", desact && await hastaTexto("puede volver a entrar", 12000));
  await salir();

  // ---------- Visor ----------
  caso("UAT-31", "HU-08 · el visor inicia sesión", await entrar(cuentas.visor.email, cuentas.visor.clave));
  await espera(2500);
  caso("UAT-32", "HU-08 · el visor no ve el menú Usuarios", !(await js('[...document.querySelectorAll(".sb__nav a")].some((a) => a.innerText.includes("Usuarios"))')));
  await ir("/dashboard", 4500);
  caso("UAT-33", "HU-08 · el visor ve el ciclo pero no puede iniciar uno", await js('document.querySelector(".lv-ctrl .btn2--pri")?.disabled === true') && /Solo operación puede iniciar un ciclo/.test(await texto()));
  await ir("/usuarios", 4000);
  caso("UAT-34", "HU-08 · el visor no entra a Usuarios: ve «Sin permisos»", /Sin permisos/.test(await texto()));
  await captura("13-sin-permisos");
  await ir("/configuracion", 4000);
  caso("UAT-35", "HU-08 · el visor ve los planes pero sin botones para crear ni modificar", /planes de limpieza/.test(await texto()) && !(await js('[...document.querySelectorAll("button")].some((b) => /Nuevo plan|Modificar/.test(b.innerText))')));
  await salir();

  // ---------- Operador ----------
  caso("UAT-36", "HU-08 · el operador inicia sesión", await entrar(cuentas.operador.email, cuentas.operador.clave));
  await ir("/dashboard", 4500);
  caso("UAT-37", "HU-08 · el operador puede iniciar un ciclo, y no ve Usuarios", await js('document.querySelector(".lv-ctrl .btn2--pri")?.disabled === false') && !(await js('[...document.querySelectorAll(".sb__nav a")].some((a) => a.innerText.includes("Usuarios"))')));
  await ir("/configuracion", 4000);
  caso("UAT-38", "HU-08 · el operador no puede crear ni modificar planes", !(await js('[...document.querySelectorAll("button")].some((b) => /Nuevo plan|Modificar/.test(b.innerText))')));
  await salir();

  const fallan = resultados.filter((r) => !r.pasa);
  console.log(`\nResultado: ${resultados.length - fallan.length} de ${resultados.length} casos pasan${fallan.length ? ` · fallan: ${fallan.map((f) => f.id).join(", ")}` : ""}.`);
  process.exitCode = fallan.length ? 1 : 0;
})().catch((e) => { console.error(`ERROR del recorrido: ${e.message}`); process.exitCode = 2; })
  .finally(() => { try { ws?.close(); } catch { /* ya cerrado */ } nav.kill(); setTimeout(() => { try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* en uso */ } process.exit(); }, 800); });
