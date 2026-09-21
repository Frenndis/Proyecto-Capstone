import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();
setGlobalOptions({ region: "southamerica-west1", maxInstances: 10 });

export { ingestLectura } from "./ingest";
export { onUserCreated, setUserRole } from "./auth";
