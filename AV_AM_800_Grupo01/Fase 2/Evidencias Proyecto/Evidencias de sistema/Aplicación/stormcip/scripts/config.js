// Un solo lugar para el project ID de los emuladores: lo usan seed.js y
// simulador-ttn.js. Debe coincidir con "firebase emulators:start --project ..."
// (ver README.md en la raíz de stormcip/).
module.exports = {
  PROJECT_ID: process.env.PROJECT_ID || "stormcip-dev",
};
