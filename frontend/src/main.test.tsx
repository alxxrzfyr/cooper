import { afterEach, describe, expect, test, vi } from "vitest";

const bootstrap = vi.hoisted(() => {
  const state = { appRendered: false };
  let release = () => undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { state, ready, release: () => release() };
});

vi.mock("./runtime-config", () => ({
  loadRuntimeConfig: vi.fn(() => bootstrap.ready),
}));

vi.mock("./App", () => ({
  default: () => {
    bootstrap.state.appRendered = true;
    return null;
  },
}));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("application bootstrap", () => {
  test("waits for runtime configuration before importing and rendering the app", async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import("./main");
    await Promise.resolve();

    expect(bootstrap.state.appRendered).toBe(false);

    bootstrap.release();
    await vi.waitFor(() => expect(bootstrap.state.appRendered).toBe(true));
  });
});
