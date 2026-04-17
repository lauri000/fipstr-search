#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_DIR="$ROOT/public"
MARK_SVG="$PUBLIC_DIR/fipstr-mark.svg"
LOGO_SVG="$PUBLIC_DIR/fipstr-logo.svg"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 'magick' is required to generate raster assets." >&2
  exit 1
fi

magick -background none -density 384 "$MARK_SVG" -resize 16x16 "$PUBLIC_DIR/favicon-16.png"
magick -background none -density 384 "$MARK_SVG" -resize 32x32 "$PUBLIC_DIR/favicon-32.png"
magick -background none -density 384 "$MARK_SVG" -resize 48x48 "$PUBLIC_DIR/favicon-48.png"
magick -background none -density 384 "$MARK_SVG" -resize 180x180 "$PUBLIC_DIR/apple-touch-icon.png"
magick -background none -density 384 "$MARK_SVG" -resize 512x512 "$PUBLIC_DIR/fipstr-mark-512.png"
magick -background none -density 240 "$LOGO_SVG" -resize 992x352 "$PUBLIC_DIR/fipstr-logo.png"
magick "$PUBLIC_DIR/favicon-16.png" "$PUBLIC_DIR/favicon-32.png" "$PUBLIC_DIR/favicon-48.png" "$PUBLIC_DIR/favicon.ico"
