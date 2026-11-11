#!/usr/bin/env python3
"""Make a print-ready JPEG of the Power Broker collage.

The default output is the recommended Staples file: a 24 x 36 inch sheet at
300 PPI, with the artwork fitted and centered on white. The JPEG is quality
95 with 4:4:4 chroma, an sRGB profile, and no EXIF data.

Run it from the repository:

    python3 tools/make-poster.py painting-10800px.png

It needs Pillow:

    python3 -m pip install Pillow

The output goes to poster-print/painting-24x36-300ppi-q95.jpg.

Staples accepts files up to 100 MB. At 24 x 36 inches and 300 PPI, the
recommended file is about 37 MB.
"""

import argparse
import os
import sys

try:
    from PIL import Image, ImageCms
except ModuleNotFoundError as error:
    raise SystemExit(
        "Pillow is required. Install it with: python3 -m pip install Pillow"
    ) from error

MAX_PIXELS = None


def load_rgb(path):
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    image = Image.open(path)
    if image.mode in ("RGBA", "LA"):
        background = Image.new("RGB", image.size, "white")
        background.paste(image, mask=image.getchannel("A"))
        return background
    return image.convert("RGB")


def srgb_profile():
    profile = bytearray(
        ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    )
    # lcms writes the current time into the ICC header's date/time field
    # (bytes 24-35). Fix it so the output bytes are reproducible.
    profile[24:36] = bytes.fromhex("07e400010001000000000000")  # 2020-01-01
    return bytes(profile)


def make_poster(source_path, output_path, width_in, height_in, dpi, quality):
    source = load_rgb(source_path)
    sheet_width = round(width_in * dpi)
    sheet_height = round(height_in * dpi)

    scale = min(sheet_width / source.width, sheet_height / source.height)
    art_width = round(source.width * scale)
    art_height = round(source.height * scale)
    art = source.resize((art_width, art_height), Image.Resampling.LANCZOS)

    sheet = Image.new("RGB", (sheet_width, sheet_height), "white")
    left = (sheet_width - art_width) // 2
    top = (sheet_height - art_height) // 2
    sheet.paste(art, (left, top))

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    sheet.save(
        output_path,
        "JPEG",
        quality=quality,
        subsampling=0,
        dpi=(dpi, dpi),
        icc_profile=srgb_profile(),
        progressive=False,
    )

    size = os.path.getsize(output_path)
    print(f"source:  {source.width} x {source.height}")
    print(f"artwork: {art_width} x {art_height} (fit on the sheet)")
    print(f"sheet:   {sheet_width} x {sheet_height} ({width_in:g} x {height_in:g} in at {dpi} PPI)")
    print(f"margins: {left} px left/right, {top} px top/bottom")
    print(f"output:  {output_path} ({size / 1e6:.1f} MB)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="source PNG, such as painting-10800px.png")
    parser.add_argument(
        "-o",
        "--output",
        default="poster-print/painting-24x36-300ppi-q95.jpg",
        help="output JPEG path (default: %(default)s)",
    )
    parser.add_argument("--width-in", type=float, default=24, help="sheet width in inches")
    parser.add_argument("--height-in", type=float, default=36, help="sheet height in inches")
    parser.add_argument("--dpi", type=int, default=300, help="print resolution")
    parser.add_argument("--quality", type=int, default=95, help="JPEG quality")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        sys.exit(f"missing input file: {args.input}")

    make_poster(
        args.input,
        args.output,
        args.width_in,
        args.height_in,
        args.dpi,
        args.quality,
    )


if __name__ == "__main__":
    main()
