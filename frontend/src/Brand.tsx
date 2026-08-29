/**
 * The wordmark, drawn rather than loaded.
 *
 * The supplied logo is a webp with dark ink baked in, so it nearly vanished on a black
 * background. Inline SVG plus real text is theme-aware by construction, sharp at any size, and
 * one less asset to keep compatible with two backgrounds.
 */
export function Brand() {
  return (
    <span className="brand">
      <svg className="brand__leaf" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 22V10M12 22C8 22 4 18 4 12C4 7 8 3 12 2C16 3 20 7 20 12C20 18 16 22 12 22Z"
          fill="currentColor"
          fillOpacity="0.18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12 2C12 2 15 6 15 10C15 14 12 17 12 17C12 17 9 14 9 10C9 6 12 2 12 2Z"
          fill="currentColor"
        />
      </svg>
      <span className="brand__word">Cooper</span>
    </span>
  );
}
