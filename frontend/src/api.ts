/**
 * The only place the app talks to the backend.
 *
 * Adds the shared key and turns any non-2xx into a thrown ApiError, so a failure can never be
 * mistaken for empty data.
 */

import { ApiError, type Hours, type Item, type NewItem, type Reply, type View } from "./types";

const BASE = import.meta.env.VITE_COOPER_API ?? "http://127.0.0.1:8000";
const KEY_HEADER = "X-Cooper-Key";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set(KEY_HEADER, import.meta.env.VITE_COOPER_KEY ?? "");
  if (init?.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* a non-JSON error is still an error; the status carries the meaning */
    }
    throw new ApiError(response.status, detail);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  today: () => call<View>("/api/today"),
  // Mode is per message, not a stored setting: Manual keeps the model out of it entirely.
  say: (text: string, mode: "manual" | "ai" = "manual") =>
    call<Reply>("/api/say", post({ text, mode })),
  // Manual mode's form: fields, no parsing, no model. The same add path as a parsed sentence.
  createItem: (item: NewItem) => call<Reply>("/api/items", post(item)),
  // Bulk verbs are two steps: match lists what a phrase hits, bulk acts on the confirmed ids.
  bulkMatch: (words: string) =>
    call<{ matched: Item[]; count: number }>("/api/bulk/match", post({ words })),
  bulk: (verb: "complete" | "drop", ids: string[]) => call<Reply>("/api/bulk", post({ verb, ids })),
  schedule: () => call<{ placed: unknown[]; view: View }>("/api/schedule", post()),
  undo: () => call<Reply>("/api/undo", post()),
  act: (id: string, verb: "complete" | "drop" | "pin") =>
    call<Reply>(`/api/items/${id}/${verb}`, post()),
  edit: (id: string, changes: Partial<Pick<Item, "title" | "minutes" | "importance">>) =>
    call<{ item: Item; view: View }>(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  setHours: (hours: Omit<Hours, "timezone">) =>
    call<{ view: View }>("/api/hours", { method: "PUT", body: JSON.stringify(hours) }),
  connect: () => call<{ url: string }>("/api/google/connect", post()),
  disconnect: () => call<{ view: View }>("/api/google/disconnect", post()),
};
