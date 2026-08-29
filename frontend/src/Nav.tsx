import { Brand } from "./Brand";
import { Mascot } from "./Mascot";

export type Tab = "today" | "calendar" | "setup";

const TABS: Array<{ id: Tab; label: string; glyph: string }> = [
  { id: "today", label: "Today", glyph: "◎" },
  { id: "calendar", label: "Calendar", glyph: "▦" },
  { id: "setup", label: "Setup", glyph: "⚙" },
];

/** Frosted top bar. Brand on the left, one contextual action on the right. */
export function NavBar({
  canUndo,
  busy,
  onUndo,
}: {
  canUndo: boolean;
  busy: boolean;
  onUndo: () => void;
}) {
  return (
    <div className="navbar">
      <Brand />
      <div className="navbar__spacer" />
      {canUndo && (
        <button type="button" className="navbar__action" disabled={busy} onClick={onUndo}>
          Undo
        </button>
      )}
      <Mascot name="profile_icon" size="xs" decorative />
    </div>
  );
}

/** Frosted bottom tab bar. */
export function TabBar({
  current,
  booked,
  onChange,
}: {
  current: Tab;
  booked: number;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="tab"
          aria-current={current === tab.id ? "page" : undefined}
          onClick={() => onChange(tab.id)}
        >
          <span className="tab__glyph" aria-hidden="true">
            {tab.glyph}
          </span>
          {tab.id === "calendar" && booked > 0 && (
            <span className="tab__badge" aria-hidden="true">
              {booked}
            </span>
          )}
          <span className="tab__label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
