/** Shapes the backend returns. Mirrors cadence/app.py. */

export type Kind = "task" | "event";
export type Status = "open" | "done" | "dropped";

export interface Item {
  id: string;
  kind: Kind;
  title: string;
  notes: string | null;
  minutes: number | null;
  importance: number;
  due: string | null;
  start_at: string | null;
  end_at: string | null;
  google_event_id: string | null;
  status: Status;
  pinned: boolean;
  created_at: string;
}

export interface Ranked extends Item {
  score: number;
  why: { due: number; importance: number; age: number; quick: number };
}

export interface Hours {
  start_hour: number;
  end_hour: number;
  weekdays: number[];
  max_per_day: number;
  timezone?: string;
}

export interface View {
  now: string;
  today: string;
  timezone: string;
  shortlist: Ranked[];
  scheduled: Item[];
  hours: Hours;
  undo: string | null;
  using_model: boolean;
  calendar: { configured: boolean; connected: boolean; email: string | null };
}

export type ReplyKind =
  | "added"
  | "changed"
  | "scheduled"
  | "undone"
  | "question"
  | "note"
  | "shown";

export interface Reply {
  kind: ReplyKind;
  message: string;
  item?: Item;
  chip?: string[];
  source?: string;
  view: View;
}

/** A backend failure worth showing rather than swallowing. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}
