# Noto AI release draft checklist

Copy this checklist into the draft GitHub Release and replace every placeholder before publishing.

## Release

- Version/tag: `v<version>`
- Commit: `<full commit SHA>`
- Release owner: `<name>`
- Validation date: `<date>`

## Changelog

- Added: `<summary>`
- Changed: `<summary>`
- Fixed: `<summary>`

## Required assets

- [ ] macOS Apple Silicon DMG is attached and has a recorded size/checksum.
- [ ] Linux x86-64 Debian package is attached and has a recorded size/checksum.
- [ ] Linux x86-64 AppImage is attached and has a recorded size/checksum.
- [ ] Each required installer contains the matching native `noto-backend` sidecar.

## Automated results

- [ ] Pull-request CI passed: `<run link>`
- [ ] Main-branch CI passed: `<run link>`
- [ ] Tagged macOS build passed: `<run link>`
- [ ] Tagged Linux build passed: `<run link>`
- [ ] Release asset verification passed.

## Installed-runtime results

- [ ] DMG tested on a clean supported Apple Silicon Mac.
- [ ] Debian package tested on a clean supported Linux installation.
- [ ] AppImage tested on a clean supported Linux installation.
- [ ] Sidecar startup, authenticated readiness, normal shutdown, forced-parent cleanup, port
      release, and restart were verified on each tested operating system.
- [ ] Microphone, local SQLite persistence, and credential-vault behavior were manually tested.

## Installation

- macOS: download the `.dmg`, open it, and drag Noto AI into Applications.
- Debian/Ubuntu: `sudo apt install ./<noto-ai-package>.deb`
- AppImage: `chmod +x <Noto-AI.AppImage>` and run it directly.

## Known limitations

- Installers are unsigned until platform signing is configured; macOS and Linux may display trust
  warnings.
- Hosted transcription, notes providers, and Discord delivery require user-supplied credentials
  and are not exercised in CI.
- `<add release-specific limitations>`

Do not publish while any required asset or required validation item is unresolved. Record every
untested optional behavior explicitly rather than treating an automated build as runtime proof.
