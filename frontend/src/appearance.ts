/**
 * Light, dark, or whatever the machine says.
 *
 * Light is the default, deliberately: a calendar is a document, and documents are light unless
 * you ask otherwise. The choice lives in localStorage rather than the database because it is
 * about this screen, not about your week, and because it has to be readable before the first
 * paint — a round trip to the backend would show the wrong theme for a moment first.
 *
 * Only ever two states reach the CSS: `data-theme="light"` or `data-theme="dark"`. "System" is
 * resolved here, so no stylesheet has to know the difference.
 */

export type Appearance = "light" | "dark" | "system";

const KEY = "cooper.appearance.v1";
const DARK = "(prefers-color-scheme: dark)";

/** The colour the browser paints its own chrome, matching `--bar` in each theme. */
const CHROME = { light: "#f9f9fb", dark: "#18181a" };

export function readAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* a blocked store is not worth failing over; light is a fine answer */
  }
  return "light";
}

export function saveAppearance(choice: Appearance): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* the choice still applies for this session */
  }
}

function systemIsDark(): boolean {
  // Guarded: matchMedia is missing in some test environments, and an older WebView may not have
  // it either. Missing means "no opinion", which resolves to light.
  return window.matchMedia?.(DARK).matches ?? false;
}

export function resolve(choice: Appearance): "light" | "dark" {
  if (choice === "system") return systemIsDark() ? "dark" : "light";
  return choice;
}

export function applyAppearance(choice: Appearance): void {
  const scheme = resolve(choice);
  document.documentElement.dataset.theme = scheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", CHROME[scheme]);
}

/** Follow the machine while the choice is "system". Returns the unsubscribe. */
export function watchSystem(onChange: () => void): () => void {
  const query = window.matchMedia?.(DARK);
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}
