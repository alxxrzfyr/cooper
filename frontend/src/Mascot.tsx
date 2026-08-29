/**
 * The otter. Sizes come from the asset manifest so images reserve their space and never shift
 * the layout while loading.
 */

const SIZES: Record<string, [number, number]> = {
  profile_icon: [140, 177],
  task_active: [169, 165],
  activity_summary: [140, 166],
  empty_state_windows: [174, 168],
  activity_history: [182, 175],
  first_run_state: [176, 161],
  degraded_mode_state: [172, 169],
  credential_expired_state: [178, 167],
  parse_ambiguity_state: [128, 172],
  task_too_large_state: [194, 159],
};

const ALT: Record<string, string> = {
  profile_icon: "Cadence otter holding a coffee",
  task_active: "Cadence otter working at a laptop",
  activity_summary: "Cadence otter reading",
  empty_state_windows: "Cadence otter painting",
  activity_history: "Cadence otter reading by a lamp",
  first_run_state: "Cadence otter waving",
  degraded_mode_state: "Tired Cadence otter",
  credential_expired_state: "Cadence otter beside a disconnected calendar",
  parse_ambiguity_state: "Puzzled Cadence otter",
  task_too_large_state: "Cadence otter lifting a heavy barbell",
};

export function Mascot({
  name,
  className,
  decorative = false,
}: {
  name: keyof typeof SIZES | string;
  className?: string;
  decorative?: boolean;
}) {
  const [width, height] = SIZES[name] ?? [160, 160];
  return (
    <img
      className={className}
      src={`/assets/mascot/${name}.webp`}
      width={width}
      height={height}
      alt={decorative ? "" : (ALT[name] ?? "Cadence otter")}
      loading="lazy"
      decoding="async"
    />
  );
}
