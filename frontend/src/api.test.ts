import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

beforeEach(() => {
  window.__COOPER_CONFIG__ = {
    authMode: "local",
    apiBase: "/runtime-api",
    localKey: "runtime-key",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  delete window.__COOPER_CONFIG__;
  vi.unstubAllGlobals();
});

describe("API runtime configuration", () => {
  test("uses the runtime API base and local key", async () => {
    vi.resetModules();
    const { api } = await import("./api");

    await api.today();

    expect(fetch).toHaveBeenCalledWith(
      "/runtime-api/api/today",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get("X-Cooper-Key")).toBe("runtime-key");
  });
});
