/** Asset names shipped in `public/assets/mascot`. */
export type MascotName =
  | "cooper_avatar"
  | "cooper_calendar"
  | "cooper_chat"
  | "cooper_done"
  | "cooper_error"
  | "cooper_idle"
  | "cooper_landing_capture"
  | "cooper_landing_hero"
  | "cooper_landing_overwhelmed"
  | "cooper_landing_ready"
  | "cooper_landing_sort"
  | "cooper_laptop"
  | "cooper_mail"
  | "cooper_painting"
  | "cooper_puzzled"
  | "cooper_reading"
  | "cooper_scheduled"
  | "cooper_secure"
  | "cooper_syncing"
  | "cooper_thinking"
  | "cooper_tired"
  | "cooper_undo"
  | "cooper_waving";

/** What Cooper is doing in each piece of art, for anyone who cannot see it. */
const ALT: Record<MascotName, string> = {
  cooper_avatar: "Cooper",
  cooper_calendar: "Cooper, pointing at a calendar",
  cooper_chat: "Cooper, chatting at a laptop",
  cooper_done: "Cooper, thumbs up",
  cooper_error: "Cooper, holding a disconnected cable",
  cooper_idle: "Cooper, standing ready to help",
  cooper_landing_capture: "Cooper, capturing a note",
  cooper_landing_hero: "Cooper, welcoming you to a calmer day",
  cooper_landing_overwhelmed: "Cooper, calmly organizing tasks",
  cooper_landing_ready: "Cooper, walking with a planner",
  cooper_landing_sort: "Cooper, sorting color-coded cards",
  cooper_laptop: "Cooper, working at a laptop",
  cooper_mail: "Cooper, holding mail",
  cooper_painting: "Cooper, painting",
  cooper_puzzled: "Cooper, puzzled",
  cooper_reading: "Cooper, reading",
  cooper_scheduled: "Cooper, scheduling on a calendar",
  cooper_secure: "Cooper, holding a lock safely",
  cooper_syncing: "Cooper, syncing mail and calendar",
  cooper_thinking: "Cooper, thinking",
  cooper_tired: "Cooper, tired",
  cooper_undo: "Cooper, holding an eraser",
  cooper_waving: "Cooper, waving",
};

export type MascotSize = "xs" | "sm" | "md" | "lg";

export function Mascot({
  name,
  size = "md",
  decorative = false,
}: {
  name: MascotName;
  size?: MascotSize;
  decorative?: boolean;
}) {
  return (
    <img
      className={`mascot mascot--${size}`}
      src={`/assets/mascot/${name}.webp`}
      alt={decorative ? "" : ALT[name]}
      loading="lazy"
      decoding="async"
    />
  );
}
