#!/usr/bin/env python3
"""
Generates frontend/src/assets/images/og-default.png — the fallback social card.

    python3 scripts/generate-og-image.py

Why this is a script and not a one-off export from a design tool: the card
carries the mission's short form, and that wording is canonical. When the
wording changes, the image has to change with it, and a PNG someone exported
once from a laptop that no longer exists cannot be regenerated. This can.

Design decisions, so they are not re-litigated later:

  * 1200x630 is the size Facebook, WhatsApp, LinkedIn and X all accept without
    re-cropping. Anything else gets cropped by at least one of them, usually
    through the middle of the text.

  * Text sits inside a 100px margin. WhatsApp crops link previews to roughly
    a 1.91:1 centre region on some clients, and the safe area is narrower than
    the canvas.

  * Colours come from frontend/src/styles/_variables.scss. If those change,
    change them here in the same commit.

  * The headline is the short-form mission verbatim. Not a slogan invented for
    the image — the whole point of canonical wording is that it appears
    identically everywhere.

  * No photograph. A generic stock room photo on every share looks like a
    stock photo; the wordmark is honest about being a wordmark, and it stays
    legible at the 200px-wide thumbnail size WhatsApp actually renders.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# ── Brand palette — mirrors frontend/src/styles/_variables.scss ──
INK = (0x1C, 0x16, 0x0E)        # $color-ink, primary text
TERRACOTTA = (0xAD, 0x42, 0x22)  # $color-terracotta, primary action
SAGE = (0x3D, 0x70, 0x40)        # $color-sage
CARD = (0xFD, 0xFA, 0xF4)        # $color-card, surface
BORDER = (0xE0, 0xD5, 0xC4)      # $color-border
SLATE = (0x7A, 0x6E, 0x60)       # $color-slate, muted text

W, H = 1200, 630
MARGIN = 100

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend/src/assets/images/og-default.png"

# Poppins is the closest available stand-in for DM Sans: same geometric sans
# skeleton, near-identical x-height at display sizes. Swap to DM Sans here if
# the brand fonts are ever self-hosted under frontend/src/assets/fonts.
FONT_DIR = Path("/usr/share/fonts/truetype/google-fonts")
BOLD = FONT_DIR / "Poppins-Bold.ttf"
MEDIUM = FONT_DIR / "Poppins-Medium.ttf"
REGULAR = FONT_DIR / "Poppins-Regular.ttf"


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    if not path.exists():
        raise SystemExit(
            f"Missing font: {path}\n"
            "Install it, or point FONT_DIR at a directory containing Poppins."
        )
    return ImageFont.truetype(str(path), size)


def main() -> None:
    img = Image.new("RGB", (W, H), CARD)
    d = ImageDraw.Draw(img)

    # Terracotta spine down the left edge. Gives the card a recognisable
    # silhouette in a feed even before any text is readable.
    d.rectangle([0, 0, 18, H], fill=TERRACOTTA)

    # Hairline frame, inset. Stops the card dissolving into a white feed
    # background on light-mode clients.
    d.rectangle([40, 40, W - 40, H - 40], outline=BORDER, width=2)

    x = MARGIN
    y = 112

    # ── Wordmark ──
    d.text((x, y), "Mastande", font=font(BOLD, 64), fill=INK)
    wordmark_w = d.textlength("Mastande", font=font(BOLD, 64))
    d.text((x + wordmark_w + 14, y + 26), "ZA", font=font(BOLD, 30), fill=TERRACOTTA)

    y += 116

    # ── Headline: the short-form mission, verbatim ──
    d.text((x, y), "Rooms to rent,", font=font(BOLD, 62), fill=INK)
    y += 78
    d.text((x, y), "direct from landlords.", font=font(BOLD, 62), fill=INK)

    y += 96

    # ── The hook, in the action colour ──
    d.text((x, y), "Free to apply. Always.", font=font(MEDIUM, 38), fill=TERRACOTTA)

    y += 68

    # ── Qualifiers ──
    d.text(
        (x, y),
        "No estate agent  ·  No application fees  ·  Prices in Rand",
        font=font(REGULAR, 26),
        fill=SLATE,
    )

    # ── Domain, bottom right ──
    domain = "umastande.co.za"
    f = font(MEDIUM, 28)
    d.text(
        (W - MARGIN - d.textlength(domain, font=f), H - MARGIN - 44),
        domain,
        font=f,
        fill=SAGE,
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # optimize=True keeps it well under the 300KB that some clients refuse to
    # fetch on a slow connection.
    img.save(OUT, "PNG", optimize=True)

    kb = OUT.stat().st_size / 1024
    print(f"Wrote {OUT.relative_to(ROOT)}  {img.width}x{img.height}  {kb:.0f}KB")
    if kb > 300:
        raise SystemExit("Over 300KB — some clients will not fetch this. Reduce it.")


if __name__ == "__main__":
    main()
