import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

async function loadRuntimeModule() {
  vi.resetModules();
  return import("../runtime-config");
}

beforeEach(() => {
  delete window.__COOPER_CONFIG__;
  vi.stubEnv("VITE_COOPER_AUTH_MODE", "");
  vi.stubEnv("VITE_COOPER_API", "");
  vi.stubEnv("VITE_COOPER_KEY", "");
  vi.stubEnv("VITE_FIREBASE_API_KEY", "");
  vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "");
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "");
  vi.stubEnv("VITE_FIREBASE_APP_ID", "");
});

afterEach(() => {
  delete window.__COOPER_CONFIG__;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("runtime configuration", () => {
  test("defaults to same-origin local mode without environment values", async () => {
    const { resolveRuntimeConfig } = await loadRuntimeModule();

    expect(resolveRuntimeConfig()).toEqual({
      authMode: "local",
      apiBase: "",
      localKey: "",
      firebase: null,
    });
  });

  test("accepts a host-provided Firebase public config", async () => {
    window.__COOPER_CONFIG__ = {
      authMode: "firebase",
      apiBase: "",
      firebase: {
        apiKey: "public-key",
        authDomain: "cooper.firebaseapp.com",
        projectId: "cooper",
        appId: "app-id",
      },
    };

    const { resolveRuntimeConfig } = await loadRuntimeModule();
    const config = resolveRuntimeConfig();

    expect(config.authMode).toBe("firebase");
    expect(config.firebase?.projectId).toBe("cooper");
  });

  test("loads Firebase Hosting config from the reserved endpoint", async () => {
    window.__COOPER_CONFIG__ = { authMode: "firebase" };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              apiKey: "public-key",
              authDomain: "cooper.firebaseapp.com",
              projectId: "cooper",
              appId: "app-id",
            }),
            { status: 200 },
          ),
      ),
    );

    const { loadRuntimeConfig } = await loadRuntimeModule();
    const config = await loadRuntimeConfig();

    expect(config.authMode).toBe("firebase");
    expect(config.firebase?.appId).toBe("app-id");
    expect(fetch).toHaveBeenCalledWith("/__/firebase/init.json", { credentials: "same-origin" });
  });

  test("keeps explicit local mode when the public endpoint is unavailable", async () => {
    vi.stubEnv("VITE_COOPER_AUTH_MODE", "local");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );

    const { loadRuntimeConfig } = await loadRuntimeModule();
    const config = await loadRuntimeConfig();

    expect(config.authMode).toBe("local");
    expect(config.firebase).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
