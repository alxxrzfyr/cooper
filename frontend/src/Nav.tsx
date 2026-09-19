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
            d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
          />
        </>
      )}
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect
        x="3.5"
        y="4"
        width="17"
        height="16"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M9 4v16" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d={collapsed ? "m13.5 9 3 3-3 3" : "m16.5 9-3 3 3 3"}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

/** Navigation rendered as tabs on narrow screens and a rail on wide screens. */
export function Nav({
  current,
  todo,
  booked,
  collapsed,
  onChange,
  onToggleCollapsed,
}: {
  current: Tab;
  todo: number;
  booked: number;
  collapsed: boolean;
  onChange: (tab: Tab) => void;
  onToggleCollapsed: () => void;
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
      </header>

      <nav className="rail" aria-label="Sections" data-collapsed={collapsed || undefined}>
        <div className="rail__brand">
          <div className="rail__brand-row">
            <div className="who">
              <Mascot name="cooper_avatar" size="xs" decorative />
              <span className="who__name">Cooper</span>
            </div>
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
              data-tour={tab.id === "chat" ? "nav-chat" : undefined}
              aria-current={current === tab.id ? "page" : undefined}
              title={collapsed ? tab.label : undefined}
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
              data-tour="nav-settings"
              aria-current={current === tab.id ? "page" : undefined}
              title={collapsed ? tab.label : undefined}
              onClick={() => onChange(tab.id)}
            >
              <span className="rail__glyph">
                <NavIcon name={tab.id} />
              </span>
              <span className="rail__label">{tab.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="rail__footer-toggle"
          aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Show sidebar" : "Hide sidebar"}
          onClick={onToggleCollapsed}
        >
          <span className="rail__footer-toggle-glyph">
            <CollapseIcon collapsed={collapsed} />
          </span>
          <span className="rail__footer-toggle-label">
            {collapsed ? "Show sidebar" : "Hide sidebar"}
          </span>
        </button>
      </nav>

      <nav className="tabbar" aria-label="Sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="tab"
            data-tour={
              tab.id === "chat" ? "nav-chat" : tab.id === "settings" ? "nav-settings" : undefined
            }
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
