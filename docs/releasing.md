# CI, Git flow, and desktop releases

The repository runs CI for every pull request into `main`, every push to `main`, and manual CI
runs. CI checks the React/TypeScript frontend, Python backend, and Rust shell, then builds native
Linux, Windows, and macOS installers. The Python sidecar is frozen on the same operating system as its
installer; it is never cross-compiled.

## Day-to-day Git flow

1. Update local `main`, then create a short-lived branch such as `feature/recording-status` or
   `fix/desktop-shutdown`.
2. Commit and push the branch. Open a pull request targeting `main`.
3. Require the CI workflow to pass before review and merge. The `Native installers` jobs make
   downloadable workflow artifacts for smoke testing; they do not publish a GitHub Release.
4. Merge the reviewed pull request into `main`. Do not develop or prepare a release directly on a
   version tag.

Configure GitHub branch protection for `main` to require pull requests and all CI jobs. The
workflow intentionally has no path filters, so changes to build scripts and release configuration
cannot bypass checks.

For example:

```sh
git switch main
git pull --ff-only
git switch -c feature/my-feature
# Make changes and run the relevant checks.
git add <specific-files>
git commit -m "feat: describe change"
git push -u origin feature/my-feature
```

Open a pull request, wait for CI, review it, and merge it. Then update local `main`:

```sh
git switch main
git pull --ff-only
```

## Prepare a release

Releases use one semantic version in all release manifests:

- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/src-tauri/Cargo.toml`
- `frontend/src-tauri/tauri.conf.json`
- `backend/pyproject.toml`

Update the version in a release pull request and run:

```sh
python scripts/check-version.py
cd frontend && npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
cd ../backend && .venv/bin/python -m ruff check . && .venv/bin/python -m ruff format --check . && .venv/bin/python -m pytest
cd ../frontend/src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets --all-features --locked -- -D warnings && cargo test --all-features --locked
```

Complete the product readiness checks in [release-checklist.md](release-checklist.md), including
clean-machine installation and runtime checks on all three operating systems. Before publishing the
generated draft, complete the
[draft-release validation checklist](release-draft-checklist.md). Automated builds do not prove
microphone, hosted provider, credential-vault, reboot persistence, or native desktop runtime
behavior.

The release workflow supports two tag-driven modes:

- **Unsigned beta:** use a prerelease version and matching tag such as `0.2.0-beta.1` and
  `v0.2.0-beta.1`. It builds `.exe`, `.msi`, `.dmg`, `.AppImage`, and `.deb` installers without
  reading or requiring signing secrets. The draft is marked as a GitHub prerelease, and installer
  filenames and workflow artifacts include `unsigned-beta`.
- **Signed production:** use a stable version and matching tag such as `0.2.0` and `v0.2.0`.
  The release policy job validates every signing secret before native packaging begins. It refuses
  to build or publish if any credential is missing.

Signed production tags require these GitHub Actions secrets before packaging starts:

- Windows: `WINDOWS_CERTIFICATE` (base64 PFX) and `WINDOWS_CERTIFICATE_PASSWORD`.
- macOS certificate: `APPLE_CERTIFICATE` (base64 P12), `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, and `KEYCHAIN_PASSWORD`.
- macOS notarization: `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password), and
  `APPLE_TEAM_ID`.

The native jobs import credentials only on their matching runner. Windows must pass Authenticode
verification. macOS must pass strict `codesign`, Gatekeeper assessment, and notarization-ticket
validation. Missing credentials fail a production tag rather than publishing unsigned assets. They
never fail an unsigned beta build, because beta mode skips certificate import, signing,
Authenticode, Gatekeeper, and notarization steps.

After the release pull request is merged and `main` is green, create and push an annotated tag at
that exact commit. For an unsigned beta, set every manifest to the same prerelease version first:

```sh
git switch main
git pull --ff-only origin main
python scripts/check-version.py
git tag -a v0.2.0-beta.1 -m "Noto AI v0.2.0-beta.1 unsigned beta"
git push origin v0.2.0-beta.1
```

For a signed production release, use a stable version and tag:

```sh
git switch main
git pull --ff-only origin main
python scripts/check-version.py
git tag -a v0.1.0 -m "Noto AI v0.1.0"
git push origin v0.1.0
```

Replace the example with the manifest version. The tag must be exactly `v` followed by that
version. The release workflow rejects a mismatch and runs the frontend, Python, and Rust checks on
the native runners. It builds the Apple Silicon sidecar and DMG on macOS, the Windows sidecar plus
NSIS `.exe` and WiX `.msi` installers on Windows, and the Linux sidecar plus Debian and AppImage
installers on Ubuntu 22.04. It only creates a draft GitHub Release after all platform jobs and
required-asset checks succeed. Production signatures are additionally verified before upload.
Review the generated notes, checklist, checksums, and installers, then publish the draft manually.

If a release build fails, fix the issue through a new pull request and create a new version/tag.
Do not move or reuse a published version tag. Branch CI packages remain suitable for internal
testing. Beta tags require no signing credentials; only stable production tags require them.
