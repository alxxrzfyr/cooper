"""Turn raw mascot art into clean, cut-out WebP.

The art arrives from an image model on a flat white background, sometimes with a warm
ground shadow painted under Cooper's feet, in whatever size and format the model felt
like. The app needs the opposite: transparent everywhere except Cooper and the things
he is holding, one square shape for every asset so nothing jitters between screens,
and WebP.

    assets-src/mascot/*.{webp,jpeg,png}   raw, straight from the model
    frontend/public/assets/mascot/*.webp  built, what the app loads

Run it after dropping new art in:

    python3 tools/mascot_cutout.py

Needs Pillow and numpy. They are deliberately not project dependencies — the app never
does this at runtime, only a person regenerating art does.

How the background is found: a flood fill inward from the edges of the frame, walking
only through pixels that are light and unsaturated. Cooper is drawn with a closed dark
ink outline, so the fill cannot leak into his cream belly or muzzle even though those
are nearly the same colour as the paper. A colour threshold on its own would eat them.
The same walk removes the ground shadow, because it is connected to the paper.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "assets-src" / "mascot"
BUILT = ROOT / "frontend" / "public" / "assets" / "mascot"
MANIFEST = ROOT / "frontend" / "public" / "assets" / "manifest.json"

# Raw stems mapped to the asset names used by the app.
BUILD = {
    "cooper_avatar": "cooper_avatar",
    "cooper_done": "cooper_done",
    "cooper_laptop": "cooper_laptop",
    "cooper_scheduled": "cooper_scheduled",
    "cooper_thinking": "cooper_thinking",
    "cooper_undo": "cooper_undo",
    "activity_summary": "cooper_reading",
    "empty_state_windows": "cooper_painting",
    "first_run_state": "cooper_waving",
    "degraded_mode_state": "cooper_tired",
    "parse_ambiguity_state": "cooper_puzzled",
}

# Background threshold for light, low-saturation pixels.
PAPER_LUMA = 168
PAPER_SATURATION = 68

# Thresholds for fading the antialiased edge.
RIM_CLEAR = 252
RIM_KEEP = 202

MARGIN = 0.06
MAX_SIDE = 512


def paper(pixels: np.ndarray) -> np.ndarray:
    """Mask of pixels that could be background: already transparent, or light and grey."""
    rgb = pixels[..., :3].astype(np.int16)
    luma = rgb.max(axis=2)
    saturation = luma - rgb.min(axis=2)
    return (pixels[..., 3] < 16) | ((luma >= PAPER_LUMA) & (saturation <= PAPER_SATURATION))


def spread(mask: np.ndarray, reach: np.ndarray, axis: int) -> np.ndarray:
    """Fill every run of `mask` along `axis` that already holds a reached pixel.

    A run is a maximal stretch of consecutive mask pixels in one row or column. Counting
    the gaps with a cumulative sum labels each run with its own number, so one pass of
    `bincount` answers "did this run get reached" for the whole image at once.
    """
    runs = np.cumsum(~mask, axis=axis)
    lanes = np.arange(mask.shape[1 - axis])
    lane = lanes.reshape(-1, 1) if axis == 1 else lanes.reshape(1, -1)
    ids = (runs + lane * (runs.max() + 1)).ravel()

    inside = mask.ravel()
    hit = np.zeros(ids.max() + 1, dtype=bool)
    hit[ids[reach.ravel()]] = True

    out = np.zeros_like(inside)
    out[inside] = hit[ids[inside]]
    return out.reshape(mask.shape)


def reachable(mask: np.ndarray) -> np.ndarray:
    """The part of `mask` a four-connected flood fill reaches from the frame edge.

    Pillow's own `ImageDraw.floodfill` does nothing at all on an ``L`` image in Pillow
    10.2 — it does not even set the seed pixel — so the fill is done here instead.
    """
    reach = np.zeros_like(mask)
    reach[0] |= mask[0]
    reach[-1] |= mask[-1]
    reach[:, 0] |= mask[:, 0]
    reach[:, -1] |= mask[:, -1]

    while True:
        before = int(reach.sum())
        reach = spread(mask, reach, axis=1)
        reach = spread(mask, reach, axis=0)
        if int(reach.sum()) == before:
            return reach


def grown(mask: np.ndarray) -> np.ndarray:
    """`mask` plus its four-connected neighbours."""
    out = mask.copy()
    out[1:, :] |= mask[:-1, :]
    out[:-1, :] |= mask[1:, :]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    return out


def cut_out(image: Image.Image) -> Image.Image:
    """Replace the paper with transparency and fade the halo it leaves behind."""
    pixels = np.array(image.convert("RGBA"))
    background = reachable(paper(pixels))

    # The rim is what is left of the antialiasing: kept pixels touching the paper.
    rim = grown(grown(background)) & ~background
    luma = pixels[..., :3].astype(np.int16).max(axis=2)
    fade = np.clip((RIM_CLEAR - luma) * 255 // (RIM_CLEAR - RIM_KEEP), 0, 255).astype(np.uint8)
    lighten = rim & (luma > RIM_KEEP)
    pixels[..., 3] = np.where(lighten, np.minimum(pixels[..., 3], fade), pixels[..., 3])
    pixels[background, 3] = 0

    return Image.fromarray(pixels, "RGBA")


def square(image: Image.Image) -> Image.Image:
    """Trim to what is actually drawn, then centre it in a square with even margins."""
    box = image.getbbox()  # getbbox ignores fully transparent rows and columns
    if box is not None:
        image = image.crop(box)

    side = round(max(image.size) / (1 - 2 * MARGIN))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(image, ((side - image.width) // 2, (side - image.height) // 2))

    if side > MAX_SIDE:
        canvas = canvas.resize((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    return canvas


def build() -> dict[str, dict[str, object]]:
    BUILT.mkdir(parents=True, exist_ok=True)
    for stale in BUILT.glob("*.webp"):
        stale.unlink()

    entries: dict[str, dict[str, object]] = {}
    for source in sorted(RAW.iterdir()):
        name = BUILD.get(source.stem)
        if name is None:
            continue

        with Image.open(source) as raw:
            art = square(cut_out(raw))

        target = BUILT / f"{name}.webp"
        # Keep alpha lossless while reducing the precached asset size.
        art.save(target, "WEBP", quality=92, alpha_quality=100, method=6)
        entries[name] = {
            "file": f"assets/mascot/{name}.webp",
            "width": art.width,
            "height": art.height,
            "format": "webp",
        }
        print(
            f"{source.name:28} -> {target.name:24} "
            f"{art.width}x{art.height}  {target.stat().st_size // 1024} KB"
        )

    return entries


def main() -> None:
    entries = build()

    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    manifest["mascots"] = entries
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")

    missing = sorted(set(BUILD) - {p.stem for p in RAW.iterdir()})
    if missing:
        print(f"\nnot found in {RAW}: {', '.join(missing)}")


if __name__ == "__main__":
    main()
