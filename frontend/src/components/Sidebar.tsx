import { BRAND, MASCOTS } from "../assets";
import { Mascot } from "./Mascot";

export type ViewName = "today" | "backlog" | "windows" | "activity" | "states";

export interface SystemStatus {
  ai: { label: string; tone: Tone };
  calendar: { label: string; tone: Tone };
  credentials: { label: string; tone: Tone };
}

export type Tone = "ok" | "warn" | "bad";

const NAV: ReadonlyArray<{ id: ViewName; label: string; available: boolean }> = [
  { id: "today", label: "Today", available: true },
  { id: "backlog", label: "Backlog", available: true },
  { id: "windows", label: "Windows", available: false },
  { id: "activity", label: "Activity", available: false },
  { id: "states", label: "States", available: true },
];

function StatusRow({ label, value }: { label: string; value: { label: string; tone: Tone } }) {
  return (
    <div className="status__row">
      <span className="status__label">{label}</span>
      <span className="status__value">
        <span className={`dot dot--${value.tone}`} aria-hidden="true" />
        {value.label}
      </span>
    </div>
  );
}

export function Sidebar({
  current,
  onNavigate,
  status,
}: {
  current: ViewName;
  onNavigate: (view: ViewName) => void;
  status: SystemStatus;
}) {
  return (
    <div className="sidebar">
      <div className="sidebar__brand">
        <img src={BRAND.logo.src} width={BRAND.logo.width} height={BRAND.logo.height} alt="Cadence" />
      </div>

      <div className="sidebar__portrait">
        <Mascot asset={MASCOTS.profile} decorative />
      </div>

      <nav className="nav" aria-label="Views">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav__item"
            aria-current={current === item.id ? "page" : undefined}
            disabled={!item.available}
            onClick={() => item.available && onNavigate(item.id)}
          >
            <span>{item.label}</span>
            {!item.available && <span className="nav__later">Later</span>}
          </button>
        ))}
      </nav>

      <div className="status">
        <span className="status__heading">System status</span>
        <StatusRow label="AI" value={status.ai} />
        <StatusRow label="Calendar" value={status.calendar} />
        <StatusRow label="Credentials" value={status.credentials} />
      </div>
    </div>
  );
}
