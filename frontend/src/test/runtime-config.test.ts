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
            }),
            { status: 200 },
          ),
      ),
    );

    const { loadRuntimeConfig } = await loadRuntimeModule();
    const config = await loadRuntimeConfig();

    expect(config.authMode).toBe("firebase");
    expect(config.firebase?.appId).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/__/firebase/init.json", { credentials: "same-origin" });
  });

  test("reads apiBase from cooper-config.json even though init.json resolves first", async () => {
    // /__/firebase/init.json is Firebase Hosting's reserved endpoint and always resolves on a
    // real deployment, but it never carries apiBase. Only cooper-config.json does, so the lookup
    // must not stop at the first source that produces a valid firebase object.
    window.__COOPER_CONFIG__ = { authMode: "firebase" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/cooper-config.json") {
          return new Response(
            JSON.stringify({
              apiBase: "https://cooper-fjfx.onrender.com",
              firebase: {
                apiKey: "public-key",
                authDomain: "cooper.firebaseapp.com",
                projectId: "cooper",
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            apiKey: "public-key",
            authDomain: "cooper.firebaseapp.com",
            projectId: "cooper",
          }),
          { status: 200 },
        );
      }),
    );

    const { loadRuntimeConfig } = await loadRuntimeModule();
    const config = await loadRuntimeConfig();

    expect(config.apiBase).toBe("https://cooper-fjfx.onrender.com");
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
