import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import serviceAccount from "../../serviceAccountKey.json" with { type: "json" };

const firebaseApp = initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const messaging = getMessaging(firebaseApp);

export { firebaseApp, db, auth, messaging };
export default firebaseApp;