import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();
setGlobalOptions({ region: "southamerica-west1", maxInstances: 10 });

export { ingestLectura } from "./http";
export { onUserCreated, setUserRole } from "./auth";
// Si ya tienes el adaptador LoRaWAN de Humberto, agrégalo aquí:
// export { ttnUplink } from "./lorawanAdapter";
