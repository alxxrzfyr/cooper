import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  reload,
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

// A popup keeps sign-in on the app's own origin. A redirect instead sends the browser to
// authDomain (a different origin from a .web.app or custom-domain deployment) and back, which
// depends on cross-origin storage access that Chrome, Firefox, and Safari now block by default —
// the user returns signed out with no error. See:
// https://firebase.google.com/docs/auth/web/redirect-best-practices
export function signInWithGoogle(): Promise<void> {
  if (!auth) return Promise.reject(new Error("Firebase is not configured."));
  return signInWithPopup(auth, new GoogleAuthProvider()).then(() => undefined);
}

export function signInWithEmail(email: string, password: string): Promise<User> {
  if (!auth) return Promise.reject(new Error("Firebase is not configured."));
  return signInWithEmailAndPassword(auth, email, password).then(({ user }) => user);
}

function actionCodeSettings(): { url: string; handleCodeInApp: false } | undefined {
  if (typeof window === "undefined") return undefined;
  return { url: `${window.location.origin}/login`, handleCodeInApp: false };
}

export async function registerWithEmail(email: string, password: string): Promise<User> {
  if (!auth) return Promise.reject(new Error("Firebase is not configured."));
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(user, actionCodeSettings());
  return user;
}

export async function resendVerificationEmail(user: User): Promise<void> {
  await sendEmailVerification(user, actionCodeSettings());
}

export function resetPassword(email: string): Promise<void> {
  if (!auth) return Promise.reject(new Error("Firebase is not configured."));
  return sendPasswordResetEmail(auth, email, actionCodeSettings());
}

export async function refreshFirebaseUser(user: User): Promise<User> {
  await reload(user);
  await user.getIdToken(true);
  return user;
}

export async function refreshCurrentUser(): Promise<User | null> {
  if (!auth?.currentUser) return null;
  return refreshFirebaseUser(auth.currentUser);
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
