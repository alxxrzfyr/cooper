/**
 * The otter.
 *
 * Always rendered inside a shaped, tinted container. The source art has an opaque warm ground
 * shadow baked under the feet, which floats visibly on a neutral surface, so `object-fit: cover`
 * with the focus high in the frame crops it away. Dropping these straight onto the page is what
 * made them look pasted on.
 */

const ALT: Record<string, string> = {
  profile_icon: "Cadence otter",
  task_active: "Cadence otter working",
  activity_summary: "Cadence otter reading",
  empty_state_windows: "Cadence otter painting",
  activity_history: "Cadence otter reading",
  first_run_state: "Cadence otter waving",
  degraded_mode_state: "Tired Cadence otter",
  credential_expired_state: "Cadence otter and a disconnected calendar",
  parse_ambiguity_state: "Puzzled Cadence otter",
  task_too_large_state: "Cadence otter lifting something heavy",
};

export type MascotSize = "xs" | "sm" | "md" | "lg";

export function Mascot({
  name,
  size = "md",
  shape = "round",
  decorative = false,
}: {
  name: string;
  size?: MascotSize;
  shape?: "round" | "squircle";
  decorative?: boolean;
}) {
  return (
    <img
      className={`mascot mascot--${shape} mascot--${size}`}
      src={`/assets/mascot/${name}.webp`}
      alt={decorative ? "" : (ALT[name] ?? "Cadence otter")}
      loading="lazy"
      decoding="async"
    />
  );
}
