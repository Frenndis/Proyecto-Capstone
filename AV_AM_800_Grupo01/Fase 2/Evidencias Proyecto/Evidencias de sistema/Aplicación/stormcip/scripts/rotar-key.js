const admin = require("firebase-admin");
const crypto = require("crypto");

const { PROJECT_ID, DEVICE_KEY, DEVICE_ID } = process.env;
if (!PROJECT_ID || !DEVICE_KEY) {
  console.error("Faltan PROJECT_ID o DEVICE_KEY.");
  process.exit(1);
}
if (DEVICE_KEY.length < 24 || DEVICE_KEY.startsWith("dev-key")) {
  console.error("DEVICE_KEY demasiado débil.");
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });

(async () => {
  const id = DEVICE_ID || "wqs-01";
  await admin.firestore().doc(`dispositivos/${id}`).update({
    apiKeyHash: crypto.createHash("sha256").update(DEVICE_KEY).digest("hex"),
  });
  console.log(`apiKeyHash actualizado en dispositivos/${id}`);
  process.exit(0);
})();