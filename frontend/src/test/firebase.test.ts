import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  app: { name: "cooper-test" },
  auth: { name: "auth-test" },
  providerScopes: [] as string[],
  initializeApp: vi.fn((config: unknown) => ({ name: "cooper-test", config })),
  getAuth: vi.fn(() => ({ name: "auth-test" })),
  onAuthStateChanged: vi.fn(() => () => undefined),
  signInWithPopup: vi.fn(async () => ({ user: { uid: "test" } })),
  signInWithEmailAndPassword: vi.fn(async () => ({ user: { uid: "test" } })),
  createUserWithEmailAndPassword: vi.fn(async () => ({ user: { uid: "test" } })),
  sendEmailVerification: vi.fn(async () => undefined),
  sendPasswordResetEmail: vi.fn(async () => undefined),
  reload: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
}));

vi.mock("firebase/app", () => ({
  initializeApp: sdk.initializeApp,
}));

vi.mock("firebase/auth", () => ({
  getAuth: sdk.getAuth,
  GoogleAuthProvider: class GoogleAuthProvider {
    addScope(scope: string): this {
      sdk.providerScopes.push(scope);
      return this;
    }
  },
  onAuthStateChanged: sdk.onAuthStateChanged,
  signInWithEmailAndPassword: sdk.signInWithEmailAndPassword,
  createUserWithEmailAndPassword: sdk.createUserWithEmailAndPassword,
  sendEmailVerification: sdk.sendEmailVerification,
  sendPasswordResetEmail: sdk.sendPasswordResetEmail,
  reload: sdk.reload,
  signInWithPopup: sdk.signInWithPopup,
  signOut: sdk.signOut,
}));

async function loadFirebase() {
  vi.resetModules();
  return import("../firebase");
}

beforeEach(() => {
  sdk.providerScopes = [];
  sdk.initializeApp.mockClear();
  sdk.getAuth.mockClear();
  sdk.onAuthStateChanged.mockClear();
  sdk.signInWithPopup.mockClear();
  sdk.signInWithEmailAndPassword.mockClear();
  sdk.createUserWithEmailAndPassword.mockClear();
  sdk.sendEmailVerification.mockClear();
  sdk.sendPasswordResetEmail.mockClear();
  sdk.reload.mockClear();
  sdk.signOut.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Firebase client auth", () => {
  test("defaults to local mode when public Firebase config is missing", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "");

    const firebase = await loadFirebase();

    expect(firebase.clientAuthMode).toBe("local");
    expect(firebase.firebaseConfigured).toBe(false);
    expect(firebase.firebaseConfigError).toBeNull();
    expect(firebase.auth).toBeNull();
    await expect(firebase.signInWithGoogle()).rejects.toThrow("Firebase is not configured.");
  });

  test("fails closed when Firebase mode is selected without complete config", async () => {
    vi.stubEnv("VITE_COOPER_AUTH_MODE", "firebase");
    vi.stubEnv("VITE_FIREBASE_API_KEY", "api-key");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "cooper");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "app-id");

    const firebase = await loadFirebase();

    expect(firebase.clientAuthMode).toBe("firebase");
    expect(firebase.firebaseConfigured).toBe(false);
    expect(firebase.firebaseConfigError).toContain("public Firebase config is incomplete");
    expect(firebase.auth).toBeNull();
    expect(sdk.initializeApp).not.toHaveBeenCalled();
  });

  test("Google sign-in does not request Calendar or Gmail scopes", async () => {
    vi.stubEnv("VITE_COOPER_AUTH_MODE", "firebase");
    vi.stubEnv("VITE_FIREBASE_API_KEY", "api-key");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "cooper.firebaseapp.com");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "cooper");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "app-id");

    const firebase = await loadFirebase();
    await firebase.signInWithGoogle();

    expect(firebase.firebaseConfigured).toBe(true);
    expect(sdk.initializeApp).toHaveBeenCalledWith({
      apiKey: "api-key",
      authDomain: "cooper.firebaseapp.com",
      projectId: "cooper",
      appId: "app-id",
    });
    expect(sdk.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(sdk.providerScopes).toEqual([]);
  });

  test("email auth uses Firebase email and password credentials", async () => {
    vi.stubEnv("VITE_COOPER_AUTH_MODE", "firebase");
    vi.stubEnv("VITE_FIREBASE_API_KEY", "api-key");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "cooper.firebaseapp.com");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "cooper");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "app-id");

    const firebase = await loadFirebase();
    await firebase.signInWithEmail("friend@example.com", "password");
    await firebase.registerWithEmail("new@example.com", "password");

    expect(sdk.signInWithEmailAndPassword).toHaveBeenCalledWith(
      { name: "auth-test" },
      "friend@example.com",
      "password",
    );
    expect(sdk.createUserWithEmailAndPassword).toHaveBeenCalledWith(
      { name: "auth-test" },
      "new@example.com",
      "password",
    );
    expect(sdk.sendEmailVerification).toHaveBeenCalledTimes(1);
  });

  test("auth subscription listens immediately, without waiting on a redirect", async () => {
    vi.stubEnv("VITE_COOPER_AUTH_MODE", "firebase");
    vi.stubEnv("VITE_FIREBASE_API_KEY", "api-key");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "cooper.firebaseapp.com");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "cooper");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "app-id");

    const firebase = await loadFirebase();
    const callback = vi.fn();
    firebase.subscribeToAuth(callback);

    expect(sdk.onAuthStateChanged).toHaveBeenCalledTimes(1);
  });
});
