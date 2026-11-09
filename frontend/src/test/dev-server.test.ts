// @vitest-environment node

import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createServer, type ViteDevServer } from "vite";

import { LandingPage } from "../landing/LandingPage";
import { AuthPage } from "../landing/AuthPage";

const localKey = "synthetic-server-proxy-key-only";
let backend: Server;
let vite: ViteDevServer;
let origin: string;

beforeAll(async () => {
  vi.stubEnv("COOPER_SHARED_KEY", localKey);
  vi.stubEnv("VITE_COOPER_KEY", "different-browser-key");
  backend = createHttpServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        path: request.url,
        key: request.headers["x-cooper-key"],
      }),
    );
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  // Load the production Vite config. Only redirect its upstream to this isolated HTTP server.
  vite = await createServer({
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: true,
      proxy: { "/api": { target }, "/health": { target } },
    },
  });
  await vite.listen();
  origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await vite?.close();
  if (backend) {
    backend.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      backend.close((error) => (error ? reject(error) : resolve())),
    );
  }
  vi.unstubAllEnvs();
}, 30_000);

test.each(["/api/today", "/health"])(
  "proxies %s with the server key, not the browser key",
  async (path) => {
    const response = await fetch(`${origin}${path}`, {
      headers: { "X-Cooper-Key": "wrong-browser-key" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path, key: localKey });
  },
);

test("serves the local frontend without exposing the proxy credential", async () => {
  const response = await fetch(origin);
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/html");
  expect(html).toContain('id="root"');
  expect(html).not.toContain(localKey);
});

test("delivers real images for the URLs rendered by landing and account pages", async () => {
  const onSignIn = () => {};
  const props = { busy: false, error: null, authEnabled: false, authLoading: false, onSignIn };
  const markup = [
    renderToStaticMarkup(createElement(LandingPage, props)),
    renderToStaticMarkup(createElement(AuthPage, { ...props, intent: "login" })),
    renderToStaticMarkup(createElement(AuthPage, { ...props, intent: "signup" })),
  ].join("");
  const urls = new Set(
    [...markup.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]),
  );
  expect(urls.size).toBeGreaterThan(0);

  for (const url of urls) {
    const response = await fetch(new URL(url, origin));
    expect(response.status, url).toBe(200);
    // A missing asset can return the SPA shell with HTTP 200; status alone is not evidence.
    expect(response.headers.get("Content-Type"), url).toMatch(/^image\//);
    expect((await response.arrayBuffer()).byteLength, url).toBeGreaterThan(0);
  }
}, 20_000);
