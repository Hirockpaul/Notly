#!/usr/bin/env python3
"""Verify that every release manifest has the same semantic version."""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--tag",
        help="also require this release tag (in the form v1.2.3) to match the manifests",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    package = json.loads((ROOT / "frontend/package.json").read_text(encoding="utf-8"))
    package_lock = json.loads(
        (ROOT / "frontend/package-lock.json").read_text(encoding="utf-8")
    )
    package_lock_version = package_lock.get("version")
    package_lock_root = package_lock.get("packages", {}).get("")
    package_lock_root_version = (
        package_lock_root.get("version")
        if isinstance(package_lock_root, dict)
        else None
    )
    if package_lock_version is None:
        print(
            "error: frontend/package-lock.json is missing its top-level version",
            file=sys.stderr,
        )
        return 1
    if package_lock_root_version is None:
        print(
            'error: frontend/package-lock.json is missing packages[""]["version"]',
            file=sys.stderr,
        )
        return 1
    tauri = json.loads(
        (ROOT / "frontend/src-tauri/tauri.conf.json").read_text(encoding="utf-8")
    )
    with (ROOT / "frontend/src-tauri/Cargo.toml").open("rb") as cargo_file:
        cargo = tomllib.load(cargo_file)
    with (ROOT / "backend/pyproject.toml").open("rb") as backend_file:
        backend = tomllib.load(backend_file)

    versions = {
        "frontend/package.json": package["version"],
        "frontend/package-lock.json (top-level)": package_lock_version,
        'frontend/package-lock.json packages[""]': package_lock_root_version,
        "frontend/src-tauri/Cargo.toml": cargo["package"]["version"],
        "frontend/src-tauri/tauri.conf.json": tauri["version"],
        "backend/pyproject.toml": backend["project"]["version"],
    }
    unique_versions = set(versions.values())
    for filename, version in versions.items():
        print(f"{filename}: {version}")

    if len(unique_versions) != 1:
        print("error: release manifest versions do not match", file=sys.stderr)
        return 1

    version = unique_versions.pop()
    if not SEMVER.fullmatch(version):
        print(f"error: {version!r} is not a valid semantic version", file=sys.stderr)
        return 1

    if args.tag and args.tag != f"v{version}":
        print(
            f"error: tag {args.tag!r} does not match manifest version v{version}",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
