/** Backend requests and response error handling. */

import {
  ApiError,
  type AskIntent,
  type Hours,
  type Item,
  type NewItem,
  type MutationReceipt,
  type RecoveryPreview,
  type Reply,
  type SyncSummary,
  type View,
} from "./types";
import { auth, clientAuthMode } from "./firebase";
import { getRuntimeConfig } from "./runtime-config";

const KEY_HEADER = "X-Cooper-Key";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (clientAuthMode === "firebase") {
    const token = await auth?.currentUser?.getIdToken();
    if (!token) throw new ApiError(401, "Sign in to continue.");
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    const localKey = getRuntimeConfig().localKey;
    if (localKey) headers.set(KEY_HEADER, localKey);
  }
  if (init?.body) headers.set("Content-Type", "application/json");

  const base = getRuntimeConfig().apiBase;
  let response: Response | undefined;
  let networkError: unknown;
  const attempts = !init?.method || init.method === "GET" ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await fetch(`${base}${path}`, { ...init, headers });
      break;
    } catch (error: unknown) {
      networkError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 750));
      }
    }
  }
  if (!response) {
    throw new ApiError(
      503,
      init?.method && init.method !== "GET"
        ? "Cooper couldn’t confirm whether that change saved. Refresh before trying again."
        : networkError instanceof TypeError
          ? "Cooper can’t reach the API right now. Check the connection and try again."
          : "Cooper couldn’t reach the API. Try again.",
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  const looksLikeJson = contentType.includes("application/json");

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    if (looksLikeJson) {
      try {
        const body = await response.json();
        if (typeof body?.detail === "string") detail = body.detail;
      } catch {
        /* a non-JSON error is still an error; the status carries the meaning */
      }
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;

  if (!looksLikeJson) {
    // Firebase Hosting SPA fallback returns HTML 200 for /api/* when apiBase is unset.
    throw new ApiError(
      502,
      "Cooper API is not configured for this site. Set the Render URL in cooper-config.json (apiBase).",
    );
  }

  return (await response.json()) as T;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  today: () => call<View>("/api/today"),
  say: (
    text: string,
    mode: "manual" | "ai" = "manual",
    intent?: AskIntent,
    logicalRequestId?: string,
  ) =>
    call<Reply>(
      "/api/say",
      post({
        text,
        mode,
        ...(intent ? { intent } : {}),
        ...(mode === "ai" && logicalRequestId ? { logical_request_id: logicalRequestId } : {}),
      }),
    ),
  createItem: (item: NewItem) => call<Reply>("/api/items", post(item)),
  bulkMatch: (words: string) =>
    call<{ matched: Item[]; count: number }>("/api/bulk/match", post({ words })),
  bulk: (verb: "complete" | "drop", ids: string[]) => call<Reply>("/api/bulk", post({ verb, ids })),
  schedule: () =>
    call<{ placed: unknown[]; receipt?: MutationReceipt; view: View }>("/api/schedule", post()),
  undo: () => call<Reply>("/api/undo", post()),
  recoveryPreview: () => call<RecoveryPreview>("/api/recovery/preview", post()),
  applyRecovery: (fingerprint: string) => call<Reply>("/api/recovery/apply", post({ fingerprint })),
  act: (id: string, verb: "complete" | "drop" | "pin" | "schedule") =>
    call<Reply>(`/api/items/${id}/${verb}`, post()),
  reschedule: (id: string, start: string, minutes: number) =>
    call<Reply>(`/api/items/${id}/move`, post({ start, minutes })),
  edit: (id: string, changes: Partial<Pick<Item, "title" | "minutes" | "importance">>) =>
    call<{ item: Item; view: View }>(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  setHours: (hours: Omit<Hours, "timezone">) =>
    call<{ view: View }>("/api/hours", { method: "PUT", body: JSON.stringify(hours) }),
  connect: () => call<{ url: string }>("/api/google/connect", post()),
  disconnect: () => call<{ view: View }>("/api/google/disconnect", post()),
  syncGoogle: () => call<{ summary: SyncSummary; view: View }>("/api/google/sync", post()),
  connectICloud: (email: string, password: string) =>
    call<{ view: View }>("/api/icloud/connect", post({ email, password })),
  disconnectICloud: () => call<{ view: View }>("/api/icloud/disconnect", post()),
};
