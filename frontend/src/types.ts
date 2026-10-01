/** Shapes returned by the backend. */

export type Kind = "task" | "event";
export type Category = "academics" | "work" | "organizations" | "personal";
export type Status = "open" | "done" | "dropped";
export type ItemSource = "me" | "gmail";

export interface Item {
  id: string;
  owner_id: string;
  source: ItemSource;
  source_ref: string | null;
  kind: Kind;
  title: string;
  notes: string | null;
  minutes: number | null;
  importance: number;
  category: Category;
  due: string | null;
  start_at: string | null;
  end_at: string | null;
  google_event_id: string | null;
  waiting_reason?: string | null;
  status: Status;
  pinned: boolean;
  created_at: string;
}

export interface Ranked extends Item {
  score: number;
  why: { due: number; importance: number; age: number; quick: number };
  state?: PlanningTaskState;
}

/** Fields sent by the Form capture surface. */
export interface NewItem {
  title: string;
  kind?: Kind;
  minutes?: number | null;
  importance?: number;
  category?: Category | null;
  due?: string | null;
  start?: string | null;
  end?: string | null;
  meeting_url?: string | null;
  location?: string | null;
  notes?: string | null;
}

export interface Hours {
  start_hour: number;
  end_hour: number;
  weekdays: number[];
  max_per_day: number;
  windows?: [number, number, number][] | null;
  break_minutes?: number;
  max_minutes_per_day?: number | null;
  timezone?: string;
}

/** An event read from an external calendar. */
export interface CalendarEventAttendee {
  email: string;
  name: string | null;
  response_status: string | null;
}

export interface CalendarEventLink {
  label: string;
  url: string;
}

export interface CalendarEventReminder {
  method: string | null;
  minutes: number | null;
  use_default: boolean;
  trigger?: string | null;
}

export interface CalendarEventAttachment {
  title: string | null;
  url: string | null;
  mime_type: string | null;
}

export interface CalendarEventMetadata {
  label: string;
  value: string;
}

export interface CalendarEvent {
  event_id?: string;
  title: string;
  start_at: string;
  end_at: string;
  category: Category;
  mine: boolean;
  source: "google" | "gmail" | "icloud";
  all_day?: boolean;
  time_zone?: string | null;
  meeting_url?: string | null;
  location?: string | null;
  description?: string | null;
  organizer_email?: string | null;
  organizer_name?: string | null;
  response_status?: string | null;
  attendees?: CalendarEventAttendee[];
  calendar_name?: string | null;
  links?: CalendarEventLink[];
  reminders?: CalendarEventReminder[];
  attachments?: CalendarEventAttachment[];
  metadata?: CalendarEventMetadata[];
}

export type PlanningTaskState =
  | "not_started"
  | "scheduled"
  | "in_progress"
  | "blocked"
  | "overdue"
  | "missed_block"
  | "completed"
  | "dropped";

export interface SourceHealth {
  source: string;
  status: "ok" | "unavailable";
  message?: string;
}

export interface PlanningCommitment {
  id: string;
  source: "cooper" | "google" | "gmail" | "icloud" | string;
  source_id: string | null;
  aliases: string[];
  title: string;
  kind: Kind;
  start_at: string;
  end_at: string;
  all_day: boolean;
  category: Category;
  editable: boolean;
  local_item_id: string | null;
  conflict: boolean;
  item?: Item;
  event?: CalendarEvent;
}

export interface PlanningRisk {
  kind: string;
  item_id?: string;
  source?: string;
  message?: string;
  commitment_ids?: string[];
}

interface CapacityFacts {
  day: string;
  generated_at: string;
  demand_scope: "due_today_unscheduled";
  scheduling_scope: "all_open_local_tasks_7_days";
  due_today_ids: string[];
  overdue_ids: string[];
  other_backlog_count: number;
  missed_block_ids: string[];
  unknown_estimate_ids: string[];
  unknown_estimate_count: number;
  assessment_partial: boolean;
  known_estimated_due_today_minutes: number;
  candidate_slots: Array<{ item_id: string; start_at: string; end_at: string }>;
  unplaced: Array<{ item_id: string; reason: "overdue" | "no_feasible_slot" }>;
}

export type TodayCapacity = CapacityFacts &
  (
    | { status: "checked" | "needs_estimates"; open_window_minutes: number }
    | { status: "source_unavailable"; candidate_slots: []; open_window_minutes?: never }
  );

export interface PlanningSnapshot {
  capacity?: TodayCapacity;
  recommended_start_at?: string | null;
  generated_at: string;
  today: string;
  timezone: string;
  complete: boolean;
  source_health: SourceHealth[];
  commitments: PlanningCommitment[];
  tasks: Ranked[];
  focus: { now_id: string | null; next_id: string | null };
  risks: PlanningRisk[];
  metrics: {
    scheduled_count: number;
    occupied_minutes: number;
    remaining_effort_minutes: number;
    current_free_block_minutes: number;
    largest_free_block_minutes: number;
    conflict_count: number;
  };
}

export interface MutationReceipt {
  operation: "create" | "reschedule" | "schedule";
  items: Array<{
    id: string;
    title: string;
    state: PlanningTaskState;
    start_at: string | null;
    end_at: string | null;
  }>;
  warnings: string[];
  snapshot_generated_at: string;
}

export interface GmailHealth {
  configured: boolean;
  connected: boolean;
  last_checked: string | null;
  last_error: string | null;
  imported: number;
  skipped: number;
}

export interface SyncSummary {
  created: number;
  updated: number;
  dropped: number;
  skipped: number;
  error: string | null;
}

export interface View {
  source_health?: SourceHealth[];
  now: string;
  today: string;
  timezone: string;
  shortlist: Ranked[];
  scheduled: Item[];
  hours: Hours;
  events: CalendarEvent[];
  planning: PlanningSnapshot;
  undo: string | null;
  using_model: boolean;
  ai?: {
    status: "ready" | "exhausted" | "unavailable";
    tier: "free" | "pilot_plus";
    remaining_units: number;
    limit_units: number;
    reset_at: string | null;
  };
  calendar: { configured: boolean; connected: boolean; email: string | null };
  gmail: GmailHealth;
  icloud: {
    configured: boolean;
    connected: boolean;
    email: string | null;
    error: string | null;
  };
}

/** Reply kind, which determines its semantic colour. */
export type ReplyKind =
  | "added"
  | "completed"
  | "dropped"
  | "pinned"
  | "rescheduled"
  | "scheduled"
  | "undone"
  | "answered"
  | "question"
  | "note"
  | "shown"
  | "pending";

export interface Reply {
  logical_request_id?: string;
  kind: ReplyKind;
  message: string;
  item?: Item;
  chip?: string[];
  source?: string;
  tools?: { name: string; ok: boolean }[];
  intent?: AskIntent;
  facts?: string[];
  warnings?: string[];
  receipt?: MutationReceipt;
  view: View;
}

export type AskIntent =
  | "focus_week"
  | "remaining_today"
  | "work_next"
  | "fit_duration"
  | "deadline_summary"
  | "overload_check";

/** A backend failure worth showing rather than swallowing. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RecoveryRow {
  item_id: string;
  title: string;
  reason: string;
}

export interface RecoveryMove {
  item_id: string;
  title: string;
  old_start: string;
  old_end: string;
  start: string;
  end: string;
}

/** A read-only re-plan of missed local blocks; apply sends the fingerprint back. */
export interface RecoveryPreview {
  fingerprint: string;
  complete: boolean;
  moves: RecoveryMove[];
  kept: RecoveryRow[];
  unplaced: RecoveryRow[];
}

/** Read-only summary from GET /api/review/week; dates are local to the owner. */
export interface WeeklyReview {
  timezone: string;
  complete: boolean;
  past: {
    start: string;
    end: string;
    completed: Array<{ item_id: string; title: string; done_at: string }>;
  };
  unfinished: Array<{ item_id: string; title: string; state: "overdue" | "missed_block" }>;
  upcoming: Array<{
    date: string;
    fixed_minutes: number;
    planned_minutes: number;
    deadlines: Array<{ item_id: string; title: string }>;
  }>;
  deadline_risks: Array<{ item_id: string; title: string; due: string; reason: string }>;
  uncertainty: { unscheduled_count: number; unknown_estimate_count: number };
}
