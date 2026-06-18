"""
Placeholder app icon generator.

Run once to (re-)generate the PNGs + ICO referenced by `tauri.conf.json`.
The result is a flat, dark-teal square with white "FT" text — meant to be
replaced before public release.

    cd apps/desktop/src-tauri/icons
    python generate.py
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

HERE = Path(__file__).resolve().parent

BACKGROUND = (46, 140, 204, 255)  # accent-600 from index.css
FOREGROUND = (255, 255, 255, 255)

SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    # icon.png is what tauri-icon would consume as a master if we ever
    # regenerate the full set with `pnpm tauri icon icon.png`.
    "icon.png": 1024,
}


def render(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(img)

    # Try a few common fonts. PIL falls back to a bitmap font if none load.
    font = None
    for name in ("arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf"):
        try:
            font = ImageFont.truetype(name, int(size * 0.55))
            break
        except OSError:
            continue
    if font is None:
        font = ImageFont.load_default()

    text = "FT"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pos = ((size - tw) // 2 - bbox[0], (size - th) // 2 - bbox[1])
    draw.text(pos, text, fill=FOREGROUND, font=font)
    return img


def main() -> None:
    for name, size in SIZES.items():
        img = render(size)
        path = HERE / name
        img.save(path, format="PNG")
        print(f"wrote {path.relative_to(HERE.parent.parent.parent)} ({size}x{size})")

    # Windows .ico — bundle multiple resolutions in one container.
    ico_sizes = [16, 32, 48, 64, 128, 256]
    base = render(max(ico_sizes))
    ico_path = HERE / "icon.ico"
    base.save(ico_path, format="ICO", sizes=[(s, s) for s in ico_sizes])
    print(f"wrote {ico_path.relative_to(HERE.parent.parent.parent)} (multi-size)")


if __name__ == "__main__":
    main()
