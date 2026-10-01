import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();
setGlobalOptions({ region: "southamerica-west1", maxInstances: 10 });

// ingestLectura vive en http.ts (solo autentica y traduce);
// ttnUplink en lorawanAdapter.ts. Ambos terminan en procesarLectura().
export { ingestLectura } from "./http";
export { ttnUplink } from "./lorawanAdapter";
export { onUserCreated, setUserRole } from "./auth";
// Cierre de ciclo: invoca derivarCiclo() y deja los indicadores en el documento.
export { alCerrarCiclo, recalcularIndicadores } from "./ciclos";