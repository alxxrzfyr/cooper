import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithRedirect,
  signOut,
  type Unsubscribe,
  type User,
} from "firebase/auth";
import { getRuntimeConfig } from "./runtime-config";

export type FirebaseUser = User;
export type ClientAuthMode = "local" | "firebase";

const runtimeConfig = getRuntimeConfig();
export const clientAuthMode: ClientAuthMode = runtimeConfig.authMode;
const app: FirebaseApp | null =
  clientAuthMode === "firebase" && runtimeConfig.firebase
    ? initializeApp(runtimeConfig.firebase)
    : null;

export const firebaseConfigured = clientAuthMode === "firebase" && app !== null;
export const firebaseConfigError =
  clientAuthMode === "firebase" && app === null
    ? "Firebase auth is selected, but the public Firebase config is incomplete."
    : null;
export const auth = app ? getAuth(app) : null;

/** Finish a Google redirect before the first auth-state decision. */
let redirectReady: Promise<void> | null = null;

export function completeRedirectSignIn(): Promise<void> {
  if (!auth) return Promise.resolve();
  redirectReady ??= getRedirectResult(auth).then(
    () => undefined,
    () => undefined,
  );
  return redirectReady;
}

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
  let active = true;
  let unsub: Unsubscribe = () => undefined;
  void completeRedirectSignIn().then(() => {
    if (!active) return;
    unsub = onAuthStateChanged(auth, callback);
  });
  return () => {
    active = false;
    unsub();
  };
}
