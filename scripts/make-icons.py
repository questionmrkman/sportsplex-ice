"""Regenerates the app icons in site/icons/ (needs Pillow). Run: python scripts/make-icons.py

One design serves both "any" and "maskable" icons: everything that matters sits inside the central 60%, so a phone
can crop the icon to a circle or squircle without cutting into the rink.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "site" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG = (11, 61, 107)        # deep ice blue
ICE = (232, 244, 252)     # rink surface
LINE = (200, 40, 55)      # red centre line
BLUE = (30, 110, 190)     # faceoff circle


def draw(size: int) -> Image.Image:
    s = size * 4  # supersample, then shrink for smooth edges
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)
    # rink: a rounded rectangle, 60% wide x 42% tall, centred
    w, h = s * 0.60, s * 0.42
    x0, y0 = (s - w) / 2, (s - h) / 2
    x1, y1 = x0 + w, y0 + h
    d.rounded_rectangle((x0, y0, x1, y1), radius=h * 0.32, fill=ICE)
    # centre line + centre circle
    cx, cy = s / 2, s / 2
    lw = s * 0.018
    d.rectangle((cx - lw, y0, cx + lw, y1), fill=LINE)
    r = h * 0.30
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=BLUE, width=int(s * 0.014))
    dot = s * 0.022
    d.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill=BLUE)
    # goal lines
    for gx in (x0 + w * 0.12, x1 - w * 0.12):
        d.rectangle((gx - lw / 2, y0 + h * 0.06, gx + lw / 2, y1 - h * 0.06), fill=LINE)
    return img.resize((size, size), Image.LANCZOS)


for name, size in {"icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180}.items():
    draw(size).save(OUT / name, optimize=True)
    print("wrote", OUT / name)
