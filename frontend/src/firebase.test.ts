import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  app: { name: "cooper-test" },
  auth: { name: "auth-test" },
  providerScopes: [] as string[],
  initializeApp: vi.fn((config: unknown) => ({ name: "cooper-test", config })),
  getAuth: vi.fn(() => ({ name: "auth-test" })),
  onAuthStateChanged: vi.fn(() => () => undefined),
  signInWithRedirect: vi.fn(async () => undefined),
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
  signInWithRedirect: sdk.signInWithRedirect,
  signOut: sdk.signOut,
}));

async function loadFirebase() {
  vi.resetModules();
  return import("./firebase");
}

beforeEach(() => {
  sdk.providerScopes = [];
  sdk.initializeApp.mockClear();
  sdk.getAuth.mockClear();
  sdk.onAuthStateChanged.mockClear();
  sdk.signInWithRedirect.mockClear();
  sdk.signOut.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Firebase client auth", () => {
  test("stays disabled when public config is missing", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "");

    const firebase = await loadFirebase();

    expect(firebase.firebaseConfigured).toBe(false);
    expect(firebase.auth).toBeNull();
    await expect(firebase.signInWithGoogle()).rejects.toThrow("Firebase is not configured.");
  });

  test("Google sign-in does not request Calendar or Gmail scopes", async () => {
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
    expect(sdk.signInWithRedirect).toHaveBeenCalledTimes(1);
    expect(sdk.providerScopes).toEqual([]);
  });
});
