/** Asset names shipped in `public/assets/mascot`. */
export type MascotName =
  | "cooper_avatar"
  | "cooper_done"
  | "cooper_laptop"
  | "cooper_painting"
  | "cooper_puzzled"
  | "cooper_reading"
  | "cooper_scheduled"
  | "cooper_thinking"
  | "cooper_tired"
  | "cooper_undo"
  | "cooper_waving";

/** What Cooper is doing in each piece of art, for anyone who cannot see it. */
const ALT: Record<MascotName, string> = {
  cooper_avatar: "Cooper",
  cooper_done: "Cooper, thumbs up",
  cooper_laptop: "Cooper, working at a laptop",
  cooper_painting: "Cooper, painting",
  cooper_puzzled: "Cooper, puzzled",
  cooper_reading: "Cooper, reading",
  cooper_scheduled: "Cooper, scheduling on a calendar",
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
