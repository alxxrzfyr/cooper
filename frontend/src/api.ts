/**
 * The single place the frontend talks to the backend.
 *
 * Injects the shared-secret header the localhost hardening requires, and turns non-2xx
 * responses into thrown `ApiError`s. Callers therefore cannot silently render a failure as
 * empty data, which was an explicit review finding: an API error must look like an error.
 */

import {
  ApiError,
  type Activity,
  type AuthStart,
  type AuthStatus,
  type BlocksEnvelope,
  type CaptureResult,
  type FocusWindow,
  type HealthStatus,
  type NewWindow,
  type Placement,
  type Plan,
  type ProviderStatus,
  type RankedTask,
  type ScheduleApplied,
  type Task,
  type UndoBatch,
} from "./types";

const DEFAULT_BASE_URL = "http://127.0.0.1:8000";
export const SHARED_SECRET_HEADER = "X-Cadence-Secret";

function baseUrl(): string {
  return import.meta.env.VITE_CADENCE_API_URL ?? DEFAULT_BASE_URL;
}

function sharedSecret(): string {
  return import.meta.env.VITE_CADENCE_SHARED_SECRET ?? "";
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set(SHARED_SECRET_HEADER, sharedSecret());
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${baseUrl()}${path}`, { ...init, headers });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    let candidates: string[] = [];
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") {
        detail = body.detail;
      }
      if (Array.isArray(body?.candidates)) {
        candidates = body.candidates.map(String);
      }
    } catch {
      // A non-JSON error body is still an error; the status carries the meaning.
    }
    throw new ApiError(response.status, detail, candidates);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function body(payload: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(payload) };
}

export const api = {
  health: () => request<HealthStatus>("/health"),

  providerStatus: () => request<ProviderStatus>("/api/capture/status"),

  listTasks: (statuses?: TaskStatusFilter) =>
    request<Task[]>(statuses ? `/api/tasks?status_filter=${statuses}` : "/api/tasks"),

  createTask: (payload: NewTask) => request<Task>("/api/tasks", body(payload)),

  updateTask: (id: string, changes: Partial<NewTask>) =>
    request<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(changes) }),

  completeTask: (id: string) => request<Task>(`/api/tasks/${id}/complete`, { method: "POST" }),

  dropTask: (id: string) => request<Task>(`/api/tasks/${id}/drop`, { method: "POST" }),

  pinTask: (id: string, date: string | null) =>
    request<Task>(`/api/tasks/${id}/pin`, { method: "PUT", body: JSON.stringify({ date }) }),

  today: (limit = 5) => request<Plan>(`/api/plan/today?limit=${limit}`),

  backlog: () => request<RankedTask[]>("/api/plan/backlog"),

  capture: (utterance: string) => request<CaptureResult>("/api/capture", body({ utterance })),

  undo: (mutationId: string) =>
    request<CaptureResult>(`/api/capture/${mutationId}/undo`, { method: "POST" }),

  // --- scheduling ---

  listWindows: () => request<FocusWindow[]>("/api/windows"),

  createWindows: (payload: NewWindow) => request<FocusWindow[]>("/api/windows", body(payload)),

  updateWindow: (id: string, changes: Partial<FocusWindow>) =>
    request<FocusWindow>(`/api/windows/${id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),

  deleteWindow: (id: string) =>
    request<void>(`/api/windows/${id}`, { method: "DELETE" }),

  previewSchedule: (limit = 5) => request<Placement>(`/api/schedule/preview?limit=${limit}`),

  applySchedule: (limit = 5) =>
    request<ScheduleApplied>(`/api/schedule/apply?limit=${limit}`, { method: "POST" }),

  blocks: (days = 1) => request<BlocksEnvelope>(`/api/schedule/blocks?days=${days}`),

  drain: () => request<{ sent: number; failed: number; deferred: number; pending: number }>(
    "/api/schedule/drain",
    { method: "POST" },
  ),

  // --- activity ---

  activity: (limit = 25) => request<Activity>(`/api/activity?limit=${limit}`),

  undoBatch: (batchId: string) =>
    request<UndoBatch>(`/api/activity/${batchId}/undo`, { method: "POST" }),

  // --- google ---

  authStatus: () => request<AuthStatus>("/api/auth/status"),

  authStart: () => request<AuthStart>("/api/auth/start", { method: "POST" }),

  authDisconnect: () => request<void>("/api/auth/disconnect", { method: "POST" }),
};

export type TaskStatusFilter = "active" | "done" | "dropped" | "active,done";

export interface NewTask {
  title: string;
  notes?: string | null;
  effort_minutes?: number | null;
  importance?: number;
  deadline?: string | null;
  tags?: string[];
}
