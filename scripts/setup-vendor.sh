#!/usr/bin/env bash
# Download prebuilt Three.js + schematic-renderer UMD bundles into public/vendor/.
# Run once per clone (or whenever you clear node_modules/public/vendor).
# Total download ~30 MB. Files are git-ignored (see .gitignore).

set -euo pipefail

cd "$(dirname "$0")/.."

VENDOR_DIR="public/vendor"
mkdir -p "$VENDOR_DIR"

THREE_VERSION="0.181.2"
SR_VERSION="1.1.23"

# Three.js dropped UMD after r0.159 so we load the ES module build and
# assign the namespace to window.THREE ourselves — the schematic-renderer
# UMD (which marks `three` as external) then picks it up there.
THREE_URL="https://unpkg.com/three@${THREE_VERSION}/build/three.module.min.js"
# three.module.min.js re-exports from three.core.min.js — fetch both or the
# browser will 404 on the import statement.
THREE_CORE_URL="https://unpkg.com/three@${THREE_VERSION}/build/three.core.min.js"
SR_URL="https://unpkg.com/schematic-renderer@${SR_VERSION}/dist/schematic-renderer.umd.js"

download_if_missing() {
  local path="$1"
  local url="$2"
  if [ -s "$path" ]; then
    echo "  ok   $path (cached)"
    return 0
  fi
  echo "  get  $url"
  curl -fsSL -o "$path" "$url"
  echo "  ok   $path ($(wc -c < "$path") bytes)"
}

echo "Hydrating $VENDOR_DIR ..."
download_if_missing "$VENDOR_DIR/three.module.min.js"       "$THREE_URL"
download_if_missing "$VENDOR_DIR/three.core.min.js"         "$THREE_CORE_URL"
download_if_missing "$VENDOR_DIR/schematic-renderer.umd.js" "$SR_URL"

# Copy the resource pack (textures + models) from the vendored source tree.
# schematic-renderer's WASM tries to rebuild a virtual filesystem from this
# zip; without it the viewer throws "無法新增檔案系統：<illegal path>".
PACK_SRC="schematic-renderer/test/public/pack.zip"
if [ -s "$VENDOR_DIR/pack.zip" ]; then
  echo "  ok   $VENDOR_DIR/pack.zip (cached)"
elif [ -s "$PACK_SRC" ]; then
  cp "$PACK_SRC" "$VENDOR_DIR/pack.zip"
  echo "  ok   $VENDOR_DIR/pack.zip ($(wc -c < "$VENDOR_DIR/pack.zip") bytes, copied from $PACK_SRC)"
else
  echo "  warn pack.zip missing — viewer will fail until $PACK_SRC is present"
fi

echo "Done. Vendor assets ready."
