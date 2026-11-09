import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so Testing Library's automatic cleanup never registers. Without this
// the DOM accumulates between tests and every query finds duplicates.
afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") window.history.replaceState({}, "", "/");
});
