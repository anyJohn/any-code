# anycode Windows installer (run via: iwr -useb <url> | iex).
# Provisions node + pnpm standalone, pulls repo zip, builds web, registers anycode to PATH.
# Bundles busybox-w32 for the agent bash tool. Output is ASCII-only on purpose (no console codepage/font dependency).
#
# CN users: ANYCODE_MIRROR=cn routes node -> cdn.npmmirror.com, pnpm install -> registry.npmmirror.com
#   (rg platform subpackage goes via mirror too). pnpm standalone / repo zip stay on GitHub;
#   downloads get -TimeoutSec + 3 retries (no silent hang); still stuck? set ANYCODE_GH_PROXY.
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

# 顶部断言：AnycodeHome 须在 USERPROFILE 下（挡住异常值，保护后续 Remove-Item 锚定）
if (-not $AnycodeHome.StartsWith($env:USERPROFILE)) {
    Write-Host "!! AnycodeHome must be under USERPROFILE ($AnycodeHome)" -ForegroundColor Red; exit 1
}
# 安全删除：仅在"非空 + 存在 + 锚定在 AnycodeHome 下"才 Remove-Item，否则不动。
function Safe-Remove($p) {
    if ($p -and (Test-Path $p) -and $p.StartsWith($AnycodeHome)) {
        Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
    }
}

function Info($m) { Write-Host ">> $m" }
function Die($m) { Write-Host "!! anycode install failed: $m" -ForegroundColor Red; exit 1 }

# ===== Mirror detection (auto=timezone CN, privacy-friendly, no IP service; ANYCODE_MIRROR=cn|none override) =====
function Test-CnTz {
    try {
        switch -Wildcard ([TimeZoneInfo]::Local.Id) {
            'China Standard Time'    { return $true }
            'Taipei Standard Time'   { return $true }
            'Ulaanbaatar Standard Time' { return $true }
        }
    } catch {}
    return $false
}
$mirror = if ($env:ANYCODE_MIRROR) { $env:ANYCODE_MIRROR } else { 'auto' }
if ($mirror -eq 'cn') { $UseMirror = $true }
elseif ($mirror -eq 'none') { $UseMirror = $false }
elseif ($mirror -eq 'auto') { $UseMirror = Test-CnTz }
else { Die "ANYCODE_MIRROR accepts cn|auto|none only (got: $mirror)" }
# per-source env overrides take precedence; else default by detection; else direct.
if ($UseMirror) {
    $DefNodeBase = 'https://cdn.npmmirror.com/binaries/node'
    $DefNpmRegistry = 'https://registry.npmmirror.com'
} else {
    $DefNodeBase = 'https://nodejs.org/dist'
    $DefNpmRegistry = ''
}
$NodeBase    = if ($env:ANYCODE_NODE_BASE)    { $env:ANYCODE_NODE_BASE }    else { $DefNodeBase }
$NpmRegistry = if ($env:ANYCODE_NPM_REGISTRY) { $env:ANYCODE_NPM_REGISTRY } else { $DefNpmRegistry }
$GhProxy     = if ($env:ANYCODE_GH_PROXY)     { $env:ANYCODE_GH_PROXY }     else { '' }
if ($NpmRegistry) {
    Info "mirror: npmmirror (ANYCODE_MIRROR=$mirror; node=$NodeBase, pnpm registry=$NpmRegistry)"
} else {
    Info "mirror: direct (ANYCODE_MIRROR=$mirror). CN users stuck? set ANYCODE_MIRROR=cn"
}

# IWR has no built-in retry; wrap with -TimeoutSec + 3 attempts so a stalled connection
# times out and retries instead of hanging silently (= "stuck" symptom for CN users).
function Invoke-WebRequest-WithRetry {
    param(
        [string]$Url,
        [string]$OutFile
    )
    Info "download $Url"
    for ($i = 1; $i -le 3; $i++) {
        try {
            if ($OutFile) {
                Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 600
                return
            } else {
                $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 600
                return $resp
            }
        } catch {
            if ($i -eq 3) {
                Die "download failed: $Url (network? CN users: ANYCODE_MIRROR=cn; GitHub source: set ANYCODE_GH_PROXY). $($_.Exception.Message)"
            }
            Info "retry $i/3 after error: $($_.Exception.Message)"
            Start-Sleep -Seconds 5
        }
    }
}
# If ANYCODE_GH_PROXY set, prefix a chosen public proxy to GitHub URLs (script does not hardcode one -- they're unstable).
function Get-GhUrl($Url) {
    if ($GhProxy) { return "$($GhProxy.TrimEnd('/'))/$Url" } else { return $Url }
}

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
    $Url = "$NodeBase/$NodeVersion/$Zip"
    Invoke-WebRequest-WithRetry -Url $Url -OutFile (Join-Path $Tmp $Zip)
    $sums = (Invoke-WebRequest-WithRetry -Url "$NodeBase/$NodeVersion/SHASUMS256.txt").Content
    $line = ($sums -split "`n" | Where-Object { $_ -match "\s$Zip$" } | Select-Object -First 1)
    $expected = ($line -split '\s+')[0]
    $actual = (Get-FileHash (Join-Path $Tmp $Zip) -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected.ToLower()) { Die "node download sha256 mismatch" }
    Info "extract node..."
    Expand-Archive -Path (Join-Path $Tmp $Zip) -DestinationPath $Tmp -Force
    Safe-Remove $NodeDir
    Move-Item (Join-Path $Tmp "node-$NodeVersion-$NodeArch") $NodeDir
}
$env:PATH = "$NodeDir;$env:PATH"
Info "node: $(node -v)"

# ---- 2. busybox-w32 (agent bash tool; single ~700KB exe = sh + coreutils, no extraction) ----
# leaner than PortableGit (~400MB with full git+mingw64) which we don't need -- only sh+coreutils.
$BusyboxDir = Join-Path $AnycodeHome 'runtime\busybox'
$ShExe = Join-Path $BusyboxDir 'sh.exe'
if (-not (Test-Path $ShExe)) {
    Safe-Remove $BusyboxDir
    $null = New-Item -ItemType Directory -Force -Path $BusyboxDir
    Invoke-WebRequest-WithRetry -Url 'https://frippery.org/files/busybox/busybox64.exe' -OutFile $ShExe
    if (-not (Test-Path $ShExe)) { Die "busybox-w32 download failed" }
}

# ---- 3. repo ----
$App = Join-Path $AnycodeHome 'app'
if (-not (Test-Path (Join-Path $App 'package.json'))) {
    $Url = Get-GhUrl "https://github.com/$Org/$Repo/archive/refs/heads/$Branch.zip"
    $Zip = Join-Path $Tmp 'repo.zip'
    Info "pull repo $Org/$Repo@$Branch (zip, no git needed)..."
    Invoke-WebRequest-WithRetry -Url $Url -OutFile $Zip
    Expand-Archive -Path $Zip -DestinationPath $Tmp -Force
    Safe-Remove $App
    Move-Item (Join-Path $Tmp "$Repo-$Branch") $App
}

# ---- 4. pnpm standalone (bypass corepack 0.29 signature bug; ships its own node) ----
$PnpmDir = Join-Path $AnycodeHome 'runtime\pnpm'
if (-not (Test-Path (Join-Path $PnpmDir 'pnpm.exe'))) {
    $pnpmAsset = if ($arch -eq 'ARM64') { 'pnpm-win32-arm64.zip' } else { 'pnpm-win32-x64.zip' }
    $url = Get-GhUrl "https://github.com/pnpm/pnpm/releases/download/v$PnpmVersion/$pnpmAsset"
    $zip = Join-Path $Tmp 'pnpm.zip'
    Info "download pnpm $PnpmVersion ($pnpmAsset)..."
    Invoke-WebRequest-WithRetry -Url $url -OutFile $zip
    Safe-Remove $PnpmDir
    $null = New-Item -ItemType Directory -Force -Path $PnpmDir
    Expand-Archive -Path $zip -DestinationPath $PnpmDir -Force
}
$env:PATH = "$PnpmDir;$NodeDir;$env:PATH"
Info "pnpm: $(pnpm --version)"

# ---- 5. build ----
Set-Location $App
# pnpm install via mirror registry (when mirror on): rg platform subpackage goes via mirror too, no GitHub.
# Writing .npmrc is the method pnpm reliably reads (npm_config_registry env is not always honored).
if ($NpmRegistry) {
    Set-Content -Path (Join-Path $App '.npmrc') -Value "registry=$NpmRegistry" -NoNewline
}
Info "pnpm install (may take minutes; if stuck, Ctrl+C and set ANYCODE_MIRROR=cn)..."
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Die "pnpm install failed (exit $LASTEXITCODE)" }
Info "build web (next build -> standalone)..."
pnpm --filter '@any-code/web' build
if ($LASTEXITCODE -ne 0) { Die "next build failed (exit $LASTEXITCODE)" }

# ---- 5b. standalone post-process: vendor rg / copy static / drop build-only deps ----
Info "post-process standalone..."
# 1. vendor rg binary (standalone lacks @vscode/ripgrep platform binary; locate via Get-ChildItem, avoid ESM require)
$RgDir = Join-Path $AnycodeHome 'runtime\rg'
$null = New-Item -ItemType Directory -Force -Path $RgDir
$rgSrc = Get-ChildItem -Recurse -File (Join-Path $App 'node_modules\.pnpm') -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'rg.exe' -or $_.Name -eq 'rg' } | Select-Object -First 1
if ($rgSrc) { Copy-Item $rgSrc.FullName (Join-Path $RgDir $rgSrc.Name) -Force }
else { Die "ripgrep binary not found (@vscode/ripgrep platform package)" }
# 2. copy static + public into standalone (server.js serves from standalone/web/.next/static)
$StandaloneWeb = Join-Path $App 'web\.next\standalone\web'
$null = New-Item -ItemType Directory -Force -Path (Join-Path $StandaloneWeb '.next')
Copy-Item -Recurse -Force (Join-Path $App 'web\.next\static') (Join-Path $StandaloneWeb '.next\static')
if (Test-Path (Join-Path $App 'web\public')) { Copy-Item -Recurse -Force (Join-Path $App 'web\public') (Join-Path $StandaloneWeb 'public') }
# 3. keep only .next/standalone (runtime); delete the rest of .next (build traces, ~280MB)
Get-ChildItem -Force (Join-Path $App 'web\.next') | Where-Object { $_.Name -ne 'standalone' } | ForEach-Object { Safe-Remove $_.FullName }
# 4. drop build-only node_modules (standalone self-contained; ~700MB). Safe-Remove anchored.
#    Keep pnpm ($PnpmDir): a future 'anycode update' needs it to rebuild.
Safe-Remove (Join-Path $App 'node_modules')

# ---- 6. register anycode (generate thin .cmd shim: ASCII + CRLF + BOM-less via .NET) ----
# launcher logic lives in build/launcher.mjs (node); the .cmd is a 2-line shim calling private node.
# Written via [System.IO.File]::WriteAllText + UTF8Encoding($false) (no BOM -- PS 5.1 Set-Content adds BOM
# which makes cmd mis-read the first line) with explicit `r`n (CRLF).
$anycodeCmd = Join-Path $AnycodeHome 'bin\anycode.cmd'
$launcherMjs = Join-Path $App 'build\launcher.mjs'
$nodeExe = Join-Path $NodeDir 'node.exe'
$cmdContents = "@echo off`r`n`"$nodeExe`" `"$launcherMjs`" %*`r`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$null = New-Item -ItemType Directory -Force -Path (Join-Path $AnycodeHome 'bin')
[System.IO.File]::WriteAllText($anycodeCmd, $cmdContents, $utf8NoBom)
# gitBashPath into config.yaml (top-level; bash.ts reads config, not env). Skip if config.yaml absent
# (first install: AnyAgent creates config on first run; bash.ts then auto-finds PortableGit location).
# .NET ReadAllText/WriteAllText + UTF8Encoding($false): BOM-aware read + BOM-less write.
# PS 5.1's Set-Content -Encoding UTF8 writes a BOM, which makes js-yaml (domain Config.load) throw.
$cfg = Join-Path $AnycodeHome 'config.yaml'
if (Test-Path $cfg) {
    $text = [System.IO.File]::ReadAllText($cfg)
    $lines = $text -split "`r?`n"
    $idx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*gitBashPath\s*:') { $idx = $i; break }
    }
    $line = "gitBashPath: '$ShExe'"
    if ($idx -ge 0) { $lines[$idx] = $line } else { $lines += $line }
    [System.IO.File]::WriteAllText($cfg, ($lines -join "`r`n"), $utf8NoBom)
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
Write-Host "  open a NEW terminal (PowerShell or cmd), run: anycode web"
Write-Host "  browser opens http://127.0.0.1:3000"

} finally {
    if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue }
}
