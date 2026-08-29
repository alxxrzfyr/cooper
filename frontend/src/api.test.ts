import { afterEach, expect, test, vi } from "vitest";

import { apiFetch } from "./api";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("injects the shared-secret header from Vite environment", async () => {
  vi.stubEnv("VITE_CADENCE_SHARED_SECRET", "frontend-test-secret");
  const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchSpy);

  await apiFetch("/health");

  expect(fetchSpy).toHaveBeenCalledOnce();
  const [url, init] = fetchSpy.mock.calls[0];
  expect(url).toBe("http://127.0.0.1:8000/health");
  expect(new Headers(init?.headers).get("X-Cadence-Secret")).toBe("frontend-test-secret");
});
