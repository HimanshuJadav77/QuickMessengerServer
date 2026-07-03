import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";

import serviceAccount from "../../serviceAccountKey.json" with {type: "json"};

const fireabseApp = initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore(fireabseApp);
const auth = getAuth(fireabseApp);
const messaging = getMessaging(fireabseApp);

export { fireabseApp, db, auth, messaging };