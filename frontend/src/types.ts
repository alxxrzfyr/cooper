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
