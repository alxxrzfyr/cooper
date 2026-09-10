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
  why: { due: number; age: number; quick: number };
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
  source_health?: { source: string; status: "ok" | "unavailable"; message?: string }[];
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
  tools?: { name: string; ok: boolean }[];
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
