import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithRedirect,
  signOut,
  type Unsubscribe,
  type User,
} from "firebase/auth";

export type FirebaseUser = User;

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

function readConfig(): FirebaseConfig | null {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
  };
  return Object.values(config).every((value) => value.trim()) ? config : null;
}

const config = readConfig();
const app: FirebaseApp | null = config ? initializeApp(config) : null;

export const firebaseConfigured = app !== null;
export const auth = app ? getAuth(app) : null;

export function signInWithGoogle(): Promise<void> {
  if (!auth) return Promise.reject(new Error("Firebase is not configured."));
  return signInWithRedirect(auth, new GoogleAuthProvider());
}

export function signOutUser(): Promise<void> {
  return auth ? signOut(auth) : Promise.resolve();
}

export function subscribeToAuth(callback: (user: FirebaseUser | null) => void): Unsubscribe {
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
}
