export type ClientAuthMode = "local" | "firebase";

export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
}

export interface RuntimeConfig {
  authMode: ClientAuthMode;
  apiBase: string;
  localKey: string;
  firebase: FirebasePublicConfig | null;
}

export interface RuntimeConfigInput {
  authMode?: ClientAuthMode;
  apiBase?: string;
  localKey?: string;
  firebase?: Partial<FirebasePublicConfig> | null;
}

interface SourceConfig {
  authMode?: ClientAuthMode;
  apiBase?: string;
  localKey?: string;
  firebase?: FirebasePublicConfig;
}

declare global {
  interface Window {
    __COOPER_CONFIG__?: RuntimeConfigInput;
  }
}

const HOSTING_CONFIG_PATH = "/__/firebase/init.json";
const DEPLOY_CONFIG_PATH = "/cooper-config.json";

let cachedConfig: RuntimeConfig | undefined;

function onFirebaseHosting(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host.endsWith(".web.app") || host.endsWith(".firebaseapp.com");
}

async function fetchJsonConfig(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function readAuthMode(value: unknown): ClientAuthMode | undefined {
  return value === "local" || value === "firebase" ? value : undefined;
}

function readFirebaseConfig(value: unknown): FirebasePublicConfig | undefined {
  if (!isRecord(value)) return undefined;

  const apiKey = readString(value.apiKey);
  const authDomain = readString(value.authDomain);
  const projectId = readString(value.projectId);
  const appId = readString(value.appId);
  if (!apiKey || !authDomain || !projectId) return undefined;

  return { apiKey, authDomain, projectId, ...(appId ? { appId } : {}) };
}

function readWindowConfig(): SourceConfig {
  if (typeof window === "undefined") return {};

  const config = window.__COOPER_CONFIG__;
  if (!config) return {};

  return {
    authMode: readAuthMode(config.authMode),
    apiBase: readString(config.apiBase),
    localKey: readString(config.localKey),
    firebase: readFirebaseConfig(config.firebase),
  };
}

function readEnvironmentConfig(): SourceConfig {
  return {
    authMode: readAuthMode(import.meta.env.VITE_COOPER_AUTH_MODE),
    apiBase: readString(import.meta.env.VITE_COOPER_API),
    localKey: readString(import.meta.env.VITE_COOPER_KEY),
    firebase: readFirebaseConfig({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    }),
  };
}

function requestedAuthMode(windowConfig: SourceConfig, envConfig: SourceConfig) {
  return windowConfig.authMode ?? envConfig.authMode;
}

export function resolveRuntimeConfig(): RuntimeConfig {
  const windowConfig = readWindowConfig();
  const envConfig = readEnvironmentConfig();
  const firebase = windowConfig.firebase ?? envConfig.firebase ?? null;

  return {
    authMode: windowConfig.authMode ?? envConfig.authMode ?? (firebase ? "firebase" : "local"),
    apiBase: windowConfig.apiBase ?? envConfig.apiBase ?? "",
    localKey: windowConfig.localKey ?? envConfig.localKey ?? "",
    firebase,
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  cachedConfig ??= resolveRuntimeConfig();
  return cachedConfig;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cachedConfig) return cachedConfig;

  const windowConfig = readWindowConfig();
  const envConfig = readEnvironmentConfig();
  const initial = resolveRuntimeConfig();
  const explicitMode = requestedAuthMode(windowConfig, envConfig);
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const onFirebaseHost = host.endsWith(".web.app") || host.endsWith(".firebaseapp.com");
  const allowHostedLookup = explicitMode !== "local" || onFirebaseHost;

  if (!initial.firebase && allowHostedLookup) {
    for (const path of [HOSTING_CONFIG_PATH, "/cooper-config.json"] as const) {
      try {
        const response = await fetch(path, { credentials: "same-origin" });
        if (!response.ok) continue;
        const payload: unknown = await response.json();
        if (!isRecord(payload)) continue;
        const firebase = readFirebaseConfig(
          isRecord(payload.firebase) ? payload.firebase : payload,
        );
        const apiBase = readString(payload.apiBase) ?? initial.apiBase;
        if (firebase) {
          cachedConfig = {
            ...initial,
            authMode: "firebase",
            apiBase,
            firebase,
          };
          return cachedConfig;
        }
      } catch {
        // Try the next hosted config source.
      }
    }
  }

  cachedConfig = initial;
  return cachedConfig;
}
