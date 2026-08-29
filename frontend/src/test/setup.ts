import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only registers automatic cleanup when the test framework's hooks are
// global. Vitest globals are off here, so unmounting is explicit; without this the DOM
// accumulates between tests and every query finds duplicates.
afterEach(() => {
  cleanup();
});
