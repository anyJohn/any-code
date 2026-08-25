# anycode Windows installer (run via: iwr -useb <url> | iex).
# Provisions node + pnpm standalone, pulls repo zip, builds web, registers anycode to PATH.
# Bundles PortableGit for the agent bash tool. Output is ASCII-only on purpose (no console codepage/font dependency).
$ErrorActionPreference = 'Stop'
# TLS 1.2 for older Windows PowerShell 5.1 (defaults to TLS 1.0; GitHub/nodejs.org need 1.2+). PS 7 ignores this.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ===== CONFIG =====
$Org = 'anyJohn'
$Repo = 'any-code'
$Branch = 'main'
$NodeVersion = 'v22.11.0'
$PnpmVersion = '11.8.0'
$AnycodeHome = Join-Path $env:USERPROFILE '.anycode'
# ==================

function Info($m) { Write-Host ">> $m" }
function Die($m) { Write-Host "!! anycode install failed: $m" -ForegroundColor Red; exit 1 }

$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq 'AMD64') { $NodeArch = 'win-x64' }
elseif ($arch -eq 'ARM64') { $NodeArch = 'win-arm64' }
else { Die "unsupported arch: $arch" }

Info "target dir: $AnycodeHome"
$null = New-Item -ItemType Directory -Force -Path (Join-Path $AnycodeHome 'runtime'), (Join-Path $AnycodeHome 'app'), (Join-Path $AnycodeHome 'bin')
$Tmp = Join-Path $env:TEMP ("anycode-install-" + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $Tmp
try {

# ---- 1. node (next start runtime) ----
$NodeDir = Join-Path $AnycodeHome 'runtime\node'
if (-not (Test-Path (Join-Path $NodeDir 'node.exe'))) {
    Info "download node $NodeVersion ($NodeArch)..."
    $Zip = "node-$NodeVersion-$NodeArch.zip"
    $Url = "https://nodejs.org/dist/$NodeVersion/$Zip"
    Invoke-WebRequest -Uri $Url -OutFile (Join-Path $Tmp $Zip) -UseBasicParsing
    $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
    $line = ($sums -split "`n" | Where-Object { $_ -match "\s$Zip$" } | Select-Object -First 1)
    $expected = ($line -split '\s+')[0]
    $actual = (Get-FileHash (Join-Path $Tmp $Zip) -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected.ToLower()) { Die "node download sha256 mismatch" }
    Info "extract node..."
    Expand-Archive -Path (Join-Path $Tmp $Zip) -DestinationPath $Tmp -Force
    if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
    Move-Item (Join-Path $Tmp "node-$NodeVersion-$NodeArch") $NodeDir
}
$env:PATH = "$NodeDir;$env:PATH"
Info "node: $(node -v)"

# ---- 2. PortableGit (agent bash tool; not MinGit -- needs bash.exe + coreutils) ----
$GitDir = Join-Path $AnycodeHome 'runtime\portablegit'
$BashExe = Join-Path $GitDir 'bin\bash.exe'
if (-not (Test-Path $BashExe)) {
    Info "download PortableGit (for agent bash tool)..."
    $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'anycode-installer' }
    $asset = $rel.assets | Where-Object { $_.name -like 'PortableGit-*-64-bit.7z.exe' } | Select-Object -First 1
    if (-not $asset) { Die "PortableGit asset not found (git-for-windows latest release)" }
    $pgExe = Join-Path $Tmp 'portablegit.exe'
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $pgExe -UseBasicParsing
    if (Test-Path $GitDir) { Remove-Item -Recurse -Force $GitDir }
    $null = New-Item -ItemType Directory -Force -Path $GitDir
    Info "extract PortableGit (7z self-extract, -y -o)..."
    $p = Start-Process -FilePath $pgExe -ArgumentList "-y","-o$GitDir" -Wait -PassThru -WindowStyle Hidden
    if (-not (Test-Path $BashExe)) { Die "PortableGit extracted but bin\bash.exe not found (may need 7z)" }
}

# ---- 3. repo ----
$App = Join-Path $AnycodeHome 'app'
if (-not (Test-Path (Join-Path $App 'package.json'))) {
    Info "pull repo $Org/$Repo@$Branch (zip, no git needed)..."
    $Url = "https://github.com/$Org/$Repo/archive/refs/heads/$Branch.zip"
    $Zip = Join-Path $Tmp 'repo.zip'
    Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
    Expand-Archive -Path $Zip -DestinationPath $Tmp -Force
    if (Test-Path $App) { Remove-Item -Recurse -Force $App }
    Move-Item (Join-Path $Tmp "$Repo-$Branch") $App
}

# ---- 4. pnpm standalone (bypass corepack 0.29 signature bug; ships its own node) ----
$PnpmDir = Join-Path $AnycodeHome 'runtime\pnpm'
if (-not (Test-Path (Join-Path $PnpmDir 'pnpm.exe'))) {
    $pnpmAsset = if ($arch -eq 'ARM64') { 'pnpm-win32-arm64.zip' } else { 'pnpm-win32-x64.zip' }
    Info "download pnpm $PnpmVersion ($pnpmAsset)..."
    $url = "https://github.com/pnpm/pnpm/releases/download/v$PnpmVersion/$pnpmAsset"
    $zip = Join-Path $Tmp 'pnpm.zip'
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    if (Test-Path $PnpmDir) { Remove-Item -Recurse -Force $PnpmDir }
    $null = New-Item -ItemType Directory -Force -Path $PnpmDir
    Expand-Archive -Path $zip -DestinationPath $PnpmDir -Force
}
$env:PATH = "$PnpmDir;$NodeDir;$env:PATH"
Info "pnpm: $(pnpm --version)"

# ---- 5. build ----
Set-Location $App
Info "pnpm install (may take minutes)..."
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Die "pnpm install failed (exit $LASTEXITCODE)" }
Info "build web (next build)..."
pnpm --filter '@any-code/web' build
if ($LASTEXITCODE -ne 0) { Die "next build failed (exit $LASTEXITCODE)" }

# ---- 6. register anycode + config gitBashPath ----
Copy-Item (Join-Path $App 'build\launcher.bat') (Join-Path $AnycodeHome 'bin\anycode.bat') -Force
# gitBashPath into config.yaml (top-level; bash.ts reads config, not env). Skip if config.yaml absent
# (first install: AnyAgent creates config on first run; bash.ts then auto-finds PortableGit location).
$cfg = Join-Path $AnycodeHome 'config.yaml'
if (Test-Path $cfg) {
    $lines = @(Get-Content $cfg)
    $idx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*gitBashPath\s*:') { $idx = $i; break }
    }
    $line = "gitBashPath: '$BashExe'"
    if ($idx -ge 0) { $lines[$idx] = $line } else { $lines += $line }
    Set-Content -Path $cfg -Value $lines -Encoding UTF8
}
# PATH (User scope) -- .NET to avoid setx 1024 truncation
$binDir = Join-Path $AnycodeHome 'bin'
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -notlike "*$binDir*") {
    $newPath = if ($userPath) { "$binDir;$userPath" } else { $binDir }
    [Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
}

Write-Host ''
Write-Host '>> anycode installed!' -ForegroundColor Green
Write-Host "  open a NEW terminal (PowerShell or cmd), run: anycode --web"
Write-Host "  browser opens http://127.0.0.1:3000"

} finally {
    if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue }
}
