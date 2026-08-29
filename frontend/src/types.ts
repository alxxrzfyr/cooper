/**
 * Shapes returned by the Cadence backend.
 *
 * Mirrors the Pydantic models in `cadence/api/schemas.py` and `routes_plan.py`. When the
 * two diverge, the backend is correct.
 */

export type TaskStatus = "active" | "done" | "dropped";

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  effort_minutes: number | null;
  importance: number;
  deadline: string | null;
  earliest_start: string | null;
  tags: string[];
  allow_split: boolean;
  status: TaskStatus;
  slip_count: number;
  pinned_for_date: string | null;
  created_at: string;
  completed_at: string | null;
  is_blocked: boolean;
}

export type ScoreTerm =
  | "deadline_pressure"
  | "importance"
  | "slip_pressure"
  | "unblocks"
  | "age";

export interface ScoreContribution {
  term: ScoreTerm;
  normalised: number;
  weighted: number;
}

export interface RankedTask {
  rank: number;
  is_pinned: boolean;
  score: number;
  contributions: ScoreContribution[];
  task: Task;
}

export interface Plan {
  generated_at: string;
  shortlist: RankedTask[];
  backlog: RankedTask[];
  blocked: Task[];
  degraded: boolean;
}

export interface ChipField {
  label: string;
  value: string;
}

export interface ParsedChip {
  kind: string;
  summary: string;
  fields: ChipField[];
}

export interface CaptureResult {
  intent: string;
  chip: ParsedChip | null;
  task: Task | null;
  question: string | null;
  candidates: string[];
  mutation_id: string | null;
  provider: string;
  model_calls: number;
  degraded: boolean;
}

export interface ProviderStatus {
  provider: string;
  degraded: boolean;
}

export interface HealthStatus {
  status: string;
}

/** A backend failure, surfaced rather than swallowed. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly candidates: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isAmbiguous(): boolean {
    return this.status === 409;
  }
}

// --- scheduling ---

export interface FocusWindow {
  id: string;
  weekday: number;
  weekday_name: string;
  start_local: string;
  end_local: string;
  timezone: string;
  daily_block_cap: number;
  active: boolean;
  minutes: number;
}

export interface Block {
  id: string;
  task_id: string;
  task_title: string | null;
  start_utc: string;
  end_utc: string;
  minutes: number;
  state: string;
  google_event_id: string | null;
}

export interface Unplaced {
  task_id: string;
  reason: string;
}

export interface Placement {
  blocks: Block[];
  unplaced: Unplaced[];
  scheduled_minutes: number;
}

export interface ScheduleApplied {
  batch_id: string;
  placed: Block[];
  released: number;
  unplaced: Unplaced[];
  scheduled_minutes: number;
}

export interface BlocksEnvelope {
  blocks: Block[];
}

// --- activity ---

export interface Mutation {
  id: string;
  op: string;
  entity_type: string;
  entity_id: string;
  label: string;
  undone: boolean;
}

export interface Batch {
  batch_id: string;
  ts: string;
  actor: "user" | "ai";
  intent_kind: string;
  size: number;
  undone: boolean;
  mutations: Mutation[];
}

export interface Digest {
  date: string;
  ai_batches: number;
  user_batches: number;
  blocks_scheduled: number;
  blocks_released: number;
  tasks_touched: number;
}

export interface Activity {
  digest: Digest;
  batches: Batch[];
}

export interface UndoBatch {
  batch_id: string;
  reversed_count: number;
  already_undone: boolean;
  calendar_corrections: number;
}

// --- google ---

export interface AuthStatus {
  connected: boolean;
  configured: boolean;
  account_email: string | null;
  scope: string | null;
  obtained_at: string | null;
  last_refreshed_at: string | null;
  last_error: string | null;
  healthy: boolean;
  hint: string | null;
}

export interface AuthStart {
  authorization_url: string;
  scope: string;
}

export interface NewWindow {
  weekdays: number[];
  start_local: string;
  end_local: string;
  daily_block_cap?: number;
}

/** Human-readable explanation of why a task could not be placed. */
export const UNPLACED_REASONS: Record<string, string> = {
  no_effort_estimate: "needs an effort estimate",
  larger_than_any_window_space: "too large for a single block",
  no_room_left: "no room left in your windows",
};
