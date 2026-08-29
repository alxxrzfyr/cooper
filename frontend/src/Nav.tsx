import { Brand } from "./Brand";
import { Mascot } from "./Mascot";

export type Tab = "chat" | "plan" | "calendar" | "setup";

const TABS: Array<{ id: Tab; label: string; glyph: string }> = [
  { id: "chat", label: "Chat", glyph: "◍" },
  { id: "plan", label: "Plan", glyph: "◎" },
  { id: "calendar", label: "Calendar", glyph: "▦" },
  { id: "setup", label: "Setup", glyph: "⚙" },
];

/**
 * Navigation, in two shapes from one component.
 *
 * Narrow: a frosted top bar plus a frosted bottom tab bar, the way a phone app works.
 * Wide: the same tabs become a side rail, so a desktop window is not a stretched phone.
 *
 * CSS decides which is visible, so there is no width listener and nothing to keep in sync.
 */
export function Nav({
  current,
  todo,
  booked,
  canUndo,
  busy,
  onChange,
  onUndo,
}: {
  current: Tab;
  todo: number;
  booked: number;
  canUndo: boolean;
  busy: boolean;
  onChange: (tab: Tab) => void;
  onUndo: () => void;
}) {
  function count(tab: Tab): number {
    if (tab === "plan") return todo;
    if (tab === "calendar") return booked;
    return 0;
  }

  return (
    <>
      <header className="topbar">
        {current === "chat" ? (
          /* Whose thread this is, the way a messages app says it: face, then name. */
          <div className="who">
            <Mascot name="profile_icon" size="sm" decorative />
            <span className="who__name">Cooper</span>
          </div>
        ) : (
          <Brand />
        )}
        <div className="topbar__spacer" />
        {canUndo && (
          <button type="button" className="topbar__action" disabled={busy} onClick={onUndo}>
            Undo
          </button>
        )}
        {current !== "chat" && <Mascot name="profile_icon" size="xs" decorative />}
      </header>

      <nav className="rail" aria-label="Sections">
        <div className="rail__brand">
          <Brand />
        </div>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="rail__item"
            aria-current={current === tab.id ? "page" : undefined}
            onClick={() => onChange(tab.id)}
          >
            <span className="rail__glyph" aria-hidden="true">
              {tab.glyph}
            </span>
            <span className="rail__label">{tab.label}</span>
            {count(tab.id) > 0 && <span className="rail__count">{count(tab.id)}</span>}
          </button>
        ))}
        <div className="rail__spacer" />
        {canUndo && (
          <button type="button" className="rail__undo" disabled={busy} onClick={onUndo}>
            Undo
          </button>
        )}
      </nav>

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
            {count(tab.id) > 0 && (
              <span className="tab__badge" aria-hidden="true">
                {count(tab.id)}
              </span>
            )}
            <span className="tab__label">{tab.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
