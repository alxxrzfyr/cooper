import { Mascot } from "./Mascot";

export type Tab = "home" | "chat" | "calendar" | "settings";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "home", label: "Home" },
  { id: "chat", label: "Cooper" },
  { id: "calendar", label: "Calendar" },
  { id: "settings", label: "Settings" },
];

function NavIcon({ name }: { name: Tab }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      {name === "home" && (
        <>
          <path {...stroke} d="m3.5 10.5 8.5-7 8.5 7" />
          <path {...stroke} d="M5.5 9.5V20h13V9.5M9.5 20v-6h5v6" />
        </>
      )}
      {name === "chat" && (
        <>
          <path
            {...stroke}
            d="M5.3 5.5h13.4A2.3 2.3 0 0 1 21 7.8v7.1a2.3 2.3 0 0 1-2.3 2.3H11l-4.7 3v-3H5.3A2.3 2.3 0 0 1 3 14.9V7.8a2.3 2.3 0 0 1 2.3-2.3Z"
          />
          <path {...stroke} d="M8 11.3h.01M12 11.3h.01M16 11.3h.01" strokeWidth="2.4" />
        </>
      )}
      {name === "calendar" && (
        <>
          <rect {...stroke} x="4" y="5.5" width="16" height="15" rx="2" />
          <path {...stroke} d="M8 3.5v4M16 3.5v4M4 10h16" />
          <path
            {...stroke}
            d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"
            strokeWidth="2.3"
          />
        </>
      )}
      {name === "settings" && (
        <>
          <circle {...stroke} cx="12" cy="12" r="3" />
          <path
            {...stroke}
            d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.9 1.9-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-2.7v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.9-1.9.06-.06A1.7 1.7 0 0 0 7.7 15a1.7 1.7 0 0 0-1.56-1.03H6v-2.7h.08A1.7 1.7 0 0 0 7.64 10a1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.9-1.9.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56V5h2.7v.08A1.7 1.7 0 0 0 15.84 6.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 1.9 1.9-.06.06A1.7 1.7 0 0 0 19.3 10a1.7 1.7 0 0 0 1.56 1.03H21v2.7h-.08A1.7 1.7 0 0 0 19.4 15Z"
          />
        </>
      )}
    </svg>
  );
}

/** Navigation rendered as tabs on narrow screens and a rail on wide screens. */
export function Nav({
  current,
  todo,
  booked,
  undo,
  busy,
  onChange,
  onUndo,
}: {
  current: Tab;
  todo: number;
  booked: number;
  undo: string | null;
  busy: boolean;
  onChange: (tab: Tab) => void;
  onUndo: () => void;
}) {
  function count(tab: Tab): number {
    // Home is where the open tasks live now, so it carries the count the Plan tab used to.
    if (tab === "home") return todo;
    if (tab === "calendar") return booked;
    return 0;
  }

  return (
    <>
      <header className="topbar">
        {/* Who you are talking to, the way a messages app says it: face, then name. */}
        <div className="who">
          <Mascot name="cooper_avatar" size="xs" decorative />
          <span className="who__name">Cooper</span>
        </div>
        <div className="topbar__spacer" />
        {undo && (
          <button
            type="button"
            className="topbar__action"
            disabled={busy}
            onClick={onUndo}
            title={undo}
          >
            Undo
          </button>
        )}
      </header>

      <nav className="rail" aria-label="Sections">
        <div className="rail__brand">
          <div className="who">
            <Mascot name="cooper_avatar" size="xs" decorative />
            <span className="who__name">Cooper</span>
          </div>
          <p className="rail__tagline">Your time, untangled</p>
        </div>

        <div className="rail__group" role="group" aria-label="Your day">
          <span className="rail__section-label" aria-hidden="true">
            Your day
          </span>
          {TABS.filter((tab) => tab.id !== "settings").map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="rail__item"
              aria-current={current === tab.id ? "page" : undefined}
              onClick={() => onChange(tab.id)}
            >
              <span className="rail__glyph">
                <NavIcon name={tab.id} />
              </span>
              <span className="rail__label">{tab.label}</span>
              {count(tab.id) > 0 && <span className="rail__count">{count(tab.id)}</span>}
            </button>
          ))}
        </div>

        <div className="rail__spacer" />

        <div className="rail__group rail__group--secondary" role="group" aria-label="Settings">
          <span className="rail__section-label" aria-hidden="true">
            Settings
          </span>
          {TABS.filter((tab) => tab.id === "settings").map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="rail__item"
              aria-current={current === tab.id ? "page" : undefined}
              onClick={() => onChange(tab.id)}
            >
              <span className="rail__glyph">
                <NavIcon name={tab.id} />
              </span>
              <span className="rail__label">{tab.label}</span>
            </button>
          ))}
        </div>

        {undo && (
          <button type="button" className="rail__undo" disabled={busy} onClick={onUndo}>
            <span className="undo__verb">Undo</span>
            <span className="undo__what">{undo}</span>
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
            <span className="tab__glyph">
              <NavIcon name={tab.id} />
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
