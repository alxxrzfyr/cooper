/** Shapes the backend returns. Mirrors cooper/app.py. */

export type Kind = "task" | "event";
export type Category = "academics" | "work" | "organizations" | "personal";
export type Status = "open" | "done" | "dropped";

export interface Item {
  id: string;
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
  status: Status;
  pinned: boolean;
  created_at: string;
}

export interface Ranked extends Item {
  score: number;
  why: { due: number; age: number; quick: number };
}

/** What the Manual form sends. Mirrors NewItem in cooper/app.py: fields, never a sentence. */
export interface NewItem {
  title: string;
  kind?: Kind;
  minutes?: number | null;
  importance?: number;
  category?: Category | null;
  due?: string | null;
  start?: string | null;
  end?: string | null;
}

export interface Hours {
  start_hour: number;
  end_hour: number;
  weekdays: number[];
  max_per_day: number;
  timezone?: string;
}

/** An event read back from Google. `mine` marks ones Cooper created. */
export interface CalendarEvent {
  title: string;
  start_at: string;
  end_at: string;
  category: Category;
  mine: boolean;
}

export interface View {
  now: string;
  today: string;
  timezone: string;
  shortlist: Ranked[];
  scheduled: Item[];
  hours: Hours;
  events: CalendarEvent[];
  undo: string | null;
  using_model: boolean;
  calendar: { configured: boolean; connected: boolean; email: string | null };
}

/**
 * What Cooper just did, which is also what colour the reply is.
 *
 * Green for something gained or finished, red for something removed, blue for an answer, amber
 * when it needs you, plain grey for information.
 */
export type ReplyKind =
  | "added"
  | "completed"
  | "dropped"
  | "pinned"
  | "scheduled"
  | "undone"
  | "answered"
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
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
