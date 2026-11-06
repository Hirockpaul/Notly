$ErrorActionPreference = "Stop"
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RepositoryRoot "backend"
$TargetTriple = if ($args.Count -gt 0) { $args[0] } else { "x86_64-pc-windows-msvc" }

Push-Location $BackendDir
try {
  & ".venv\Scripts\python.exe" -m PyInstaller --clean --noconfirm noto-backend.spec
  $OutputDir = Join-Path $RepositoryRoot "frontend\src-tauri\binaries"
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  Copy-Item "dist\noto-backend.exe" (Join-Path $OutputDir "noto-backend-$TargetTriple.exe") -Force
} finally {
  Pop-Location
}
