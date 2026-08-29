import type { MascotAsset } from "../assets";

/**
 * Renders a mascot illustration at its intrinsic aspect ratio.
 *
 * `decorative` renders empty alt text, for the cases where adjacent text already says the
 * same thing and repeating it would only add noise for screen reader users.
 */
export function Mascot({
  asset,
  className,
  decorative = false,
}: {
  asset: MascotAsset;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      className={className}
      src={asset.src}
      width={asset.width}
      height={asset.height}
      alt={decorative ? "" : asset.alt}
      loading="lazy"
      decoding="async"
    />
  );
}
