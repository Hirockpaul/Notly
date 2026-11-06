#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_triple="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
backend_dir="$repository_root/backend"
binary_suffix=""
if [[ "$target_triple" == *windows* ]]; then binary_suffix=".exe"; fi

cd "$backend_dir"
"$backend_dir/.venv/bin/python" -m PyInstaller --clean --noconfirm noto-backend.spec
mkdir -p "$repository_root/frontend/src-tauri/binaries"
cp "$backend_dir/dist/noto-backend$binary_suffix" "$repository_root/frontend/src-tauri/binaries/noto-backend-$target_triple$binary_suffix"
echo "Created frontend/src-tauri/binaries/noto-backend-$target_triple$binary_suffix"
