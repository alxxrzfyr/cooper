/**
 * Asset references, taken from `public/assets/manifest.json`.
 *
 * Declared once with intrinsic dimensions so images reserve their space before loading and
 * never shift the layout. Alt text lives here too, beside the asset it describes.
 */

export interface MascotAsset {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

const mascot = (
  file: string,
  width: number,
  height: number,
  alt: string,
): MascotAsset => ({ src: `/assets/mascot/${file}`, width, height, alt });

export const MASCOTS = {
  profile: mascot("profile_icon.webp", 140, 177, "The Cadence otter holding a coffee"),
  taskActive: mascot("task_active.webp", 169, 165, "The Cadence otter working at a laptop"),
  activitySummary: mascot(
    "activity_summary.webp",
    140,
    166,
    "The Cadence otter reading a summary",
  ),
  windowsEmpty: mascot(
    "empty_state_windows.webp",
    174,
    168,
    "The Cadence otter painting at an easel",
  ),
  activityHistory: mascot(
    "activity_history.webp",
    182,
    175,
    "The Cadence otter reading beside a lamp",
  ),
  firstRun: mascot("first_run_state.webp", 176, 161, "The Cadence otter waving beside boxes"),
  degraded: mascot(
    "degraded_mode_state.webp",
    172,
    169,
    "The Cadence otter beside a smoking laptop",
  ),
  credentialExpired: mascot(
    "credential_expired_state.webp",
    178,
    167,
    "The Cadence otter beside a disconnected calendar",
  ),
  ambiguity: mascot(
    "parse_ambiguity_state.webp",
    128,
    172,
    "The Cadence otter looking puzzled",
  ),
  taskTooLarge: mascot(
    "task_too_large_state.webp",
    194,
    159,
    "The Cadence otter lifting an oversized barbell",
  ),
} as const satisfies Record<string, MascotAsset>;

export const BRAND = {
  logo: { src: "/assets/brand/cadence_logo.webp", width: 110, height: 25, alt: "Cadence" },
  icon: { src: "/assets/brand/cadence_icon.webp", width: 24, height: 25, alt: "" },
  wordmark: {
    src: "/assets/brand/cadence_wordmark.webp",
    width: 86,
    height: 22,
    alt: "Cadence",
  },
} as const;

export type MascotName = keyof typeof MASCOTS;
