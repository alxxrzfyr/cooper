import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applyAppearance, readAppearance, watchSystem } from "./appearance";
import { loadRuntimeConfig } from "./runtime-config";

// Before the first paint, so a dark-mode user never sees a white flash.
applyAppearance(readAppearance());
watchSystem(() => applyAppearance(readAppearance()));

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root");

async function bootstrap(root: HTMLElement): Promise<void> {
  await loadRuntimeConfig();
  const { default: App } = await import("./App");

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Installable and openable offline. Registered after load so it never delays first paint, and
  // only in production because a service worker fights the dev server's hot reload.
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js");
    });
  }
}

void bootstrap(rootElement);
