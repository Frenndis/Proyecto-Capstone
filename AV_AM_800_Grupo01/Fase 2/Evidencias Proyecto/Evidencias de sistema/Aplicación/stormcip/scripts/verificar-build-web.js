// Verifica que el build de Hosting (web/out) sea de PRODUCCIÓN: no debe apuntar
// a los emuladores ni al proyecto de desarrollo, y debe contener el proyecto real.
// Solo lee archivos; no toca Firebase.
//
// Uso, desde scripts/, después de `next build` en web/:
//   node verificar-build-web.js
// Sale con código 1 si algo falla: úsalo antes de `firebase deploy --only hosting`.
const fs = require("fs");
const path = require("path");
const { PROYECTO_PROD } = require("./entorno");

const OUT = path.join(__dirname, "..", "web", "out");

// Lo que NO debe aparecer en el build (el sitio se conectaría a los emuladores o a dev)
const PROHIBIDO = [
  ["127.0.0.1", "emuladores locales (Firestore, Auth, Functions)"],
  ["stormcip-dev", "proyecto de desarrollo"],
];

function* archivos(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* archivos(p);
    else if (/\.(js|html|json|txt|css|map)$/.test(e.name)) yield p;
  }
}

if (!fs.existsSync(OUT)) {
  console.error(`No existe ${OUT}. Corre primero el build de la web.`);
  process.exit(1);
}

const hallazgos = new Map(); // texto → archivos
let contieneProd = false;
let total = 0;
for (const f of archivos(OUT)) {
  total++;
  const txt = fs.readFileSync(f, "utf8");
  if (txt.includes(PROYECTO_PROD)) contieneProd = true;
  for (const [needle] of PROHIBIDO) {
    if (txt.includes(needle)) {
      hallazgos.set(needle, [...(hallazgos.get(needle) ?? []), path.relative(OUT, f)]);
    }
  }
}

console.log(`Revisados ${total} archivos de ${OUT}`);
let ok = true;
for (const [needle, que] of PROHIBIDO) {
  const donde = hallazgos.get(needle);
  if (donde) {
    ok = false;
    console.log(`FALLA  aparece "${needle}" (${que}) en ${donde.length} archivo(s), p. ej. ${donde[0]}`);
  } else {
    console.log(`OK     no aparece "${needle}" (${que})`);
  }
}
if (contieneProd) console.log(`OK     contiene el proyecto ${PROYECTO_PROD}`);
else { ok = false; console.log(`FALLA  no aparece el proyecto ${PROYECTO_PROD}: ¿se construyó con la configuración de producción?`); }

console.log(ok ? "\nBuild de producción verificado." : "\nNO desplegar este build.");
process.exit(ok ? 0 : 1);
