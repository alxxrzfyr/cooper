/**
 * Cooper.
 *
 * He is the app and the app is him, so he is never introduced as "the otter" — he has a name.
 *
 * The art carries an opaque warm ground ellipse under the feet. It used to be hidden by cropping
 * every mascot inside a tinted circle, which made him look like a contact photo. Now the bottom
 * of the image fades out in CSS instead, so he stands directly on the page.
 */

/**
 * One name per file in `public/assets/mascot`, as a type rather than a string.
 *
 * This was a plain `string`, and renaming the art to `cooper_*` left five call sites asking for
 * files that no longer existed. Nothing failed loudly: the dev server answers a missing asset
 * with index.html, so the page just showed a broken image. A union catches that at build time.
 */
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
