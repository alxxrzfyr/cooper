/**
 * Cooper.
 *
 * He is the app and the app is him, so he is never introduced as "the otter" — he has a name.
 *
 * The art carries an opaque warm ground ellipse under the feet. It used to be hidden by cropping
 * every mascot inside a tinted circle, which made him look like a contact photo. Now the bottom
 * of the image fades out in CSS instead, so he stands directly on the page.
 */

/** What Cooper is doing in each piece of art, for anyone who cannot see it. */
const ALT: Record<string, string> = {
  profile_icon: "Cooper",
  task_active: "Cooper, working",
  activity_summary: "Cooper, reading",
  empty_state_windows: "Cooper, painting",
  activity_history: "Cooper, reading",
  first_run_state: "Cooper, waving",
  degraded_mode_state: "Cooper, tired",
  credential_expired_state: "Cooper, holding a disconnected calendar",
  parse_ambiguity_state: "Cooper, puzzled",
  task_too_large_state: "Cooper, lifting something heavy",
  cooper_avatar: "Cooper",
  cooper_done: "Cooper, thumbs up",
  cooper_scheduled: "Cooper, scheduling on a calendar",
  cooper_thinking: "Cooper, thinking",
  cooper_undo: "Cooper, holding an eraser",
  cooper_laptop: "Cooper, working at a laptop",
};

export type MascotSize = "xs" | "sm" | "md" | "lg";

export function Mascot({
  name,
  size = "md",
  decorative = false,
}: {
  name: string;
  size?: MascotSize;
  decorative?: boolean;
}) {
  return (
    <img
      className={`mascot mascot--${size}`}
      src={`/assets/mascot/${name}.webp`}
      alt={decorative ? "" : (ALT[name] ?? "Cooper")}
      loading="lazy"
      decoding="async"
    />
  );
}
