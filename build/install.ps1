# anycode Windows 一行安装器（iwr | iex 拉取执行）。
# 流程同 install.sh + 额外下 PortableGit（agent bash 工具用，保持 bash 全平台统一）
# + setx ANYCODE_GIT_BASH_PATH（User 作用域，.NET 写避免 setx 1024 截断）。
$ErrorActionPreference = 'Stop'
# 兼容老版 Windows PowerShell 5.1：默认 TLS 1.0，下 GitHub/nodejs.org 会握手失败。PS 7 忽略此行。
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ===== CONFIG（与 versions.env 同值）=====
$Org = 'anyJohn'
$Repo = 'any-code'
$Branch = 'main'
$NodeVersion = 'v22.11.0'
$PnpmVersion = '11.8.0'
$AnycodeHome = Join-Path $env:USERPROFILE '.anycode'
# ==========================================

function Info($m) { Write-Host "▶ $m" }
function Die($m) { Write-Host "✗ anycode 安装失败：$m" -ForegroundColor Red; exit 1 }

$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq 'AMD64') { $NodeArch = 'win-x64' }
elseif ($arch -eq 'ARM64') { $NodeArch = 'win-arm64' }
else { Die "不支持的架构：$arch" }

Info "目标目录：$AnycodeHome"
$null = New-Item -ItemType Directory -Force -Path (Join-Path $AnycodeHome 'runtime'), (Join-Path $AnycodeHome 'app'), (Join-Path $AnycodeHome 'bin')
$Tmp = Join-Path $env:TEMP ("anycode-install-" + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $Tmp
try {

# ---- 1. 私有 node ----
$NodeDir = Join-Path $AnycodeHome 'runtime\node'
if (-not (Test-Path (Join-Path $NodeDir 'node.exe'))) {
    Info "下载 node $NodeVersion ($NodeArch)…"
    $Zip = "node-$NodeVersion-$NodeArch.zip"
    $Url = "https://nodejs.org/dist/$NodeVersion/$Zip"
    Invoke-WebRequest -Uri $Url -OutFile (Join-Path $Tmp $Zip) -UseBasicParsing
    # sha256 校验
    $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
    $line = ($sums -split "`n" | Where-Object { $_ -match "\s$Zip$" } | Select-Object -First 1)
    $expected = ($line -split '\s+')[0]
    $actual = (Get-FileHash (Join-Path $Tmp $Zip) -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected.ToLower()) { Die "node 下载 sha256 校验失败" }
    Info "解压 node…"
    Expand-Archive -Path (Join-Path $Tmp $Zip) -DestinationPath $Tmp -Force
    if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
    Move-Item (Join-Path $Tmp "node-$NodeVersion-$NodeArch") $NodeDir
}
$env:PATH = "$NodeDir;$env:PATH"
Info "node: $(node -v) | corepack: $(corepack --version)"

# ---- 2. PortableGit（agent bash 工具用，非 MinGit——需 bash.exe+coreutils）----
$GitDir = Join-Path $AnycodeHome 'runtime\portablegit'
$BashExe = Join-Path $GitDir 'bin\bash.exe'
if (-not (Test-Path $BashExe)) {
    Info "下载 PortableGit（agent bash 工具用）…"
    $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'anycode-installer' }
    $asset = $rel.assets | Where-Object { $_.name -like 'PortableGit-*-64-bit.7z.exe' } | Select-Object -First 1
    if (-not $asset) { Die "未找到 PortableGit asset（git-for-windows 最新 release）" }
    $pgExe = Join-Path $Tmp 'portablegit.exe'
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $pgExe -UseBasicParsing
    if (Test-Path $GitDir) { Remove-Item -Recurse -Force $GitDir }
    $null = New-Item -ItemType Directory -Force -Path $GitDir
    Info "解压 PortableGit（7z 自解压，-y -o）…"
    $p = Start-Process -FilePath $pgExe -ArgumentList "-y","-o$GitDir" -Wait -PassThru -WindowStyle Hidden
    if (-not (Test-Path $BashExe)) { Die "PortableGit 解压后未找到 bin\bash.exe（可能需 7z）" }
}

# ---- 3. 拉仓库 ----
$App = Join-Path $AnycodeHome 'app'
if (-not (Test-Path (Join-Path $App 'package.json'))) {
    Info "拉取仓库 $Org/$Repo@$Branch（zip，不依赖 git）…"
    $Url = "https://github.com/$Org/$Repo/archive/refs/heads/$Branch.zip"
    $Zip = Join-Path $Tmp 'repo.zip'
    Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
    Expand-Archive -Path $Zip -DestinationPath $Tmp -Force
    if (Test-Path $App) { Remove-Item -Recurse -Force $App }
    Move-Item (Join-Path $Tmp "$Repo-$Branch") $App
}

# ---- 4. pnpm standalone（绕开 corepack 0.29 验签 bug；自带 node）----
$PnpmDir = Join-Path $AnycodeHome 'runtime\pnpm'
if (-not (Test-Path (Join-Path $PnpmDir 'pnpm.exe'))) {
    $pnpmAsset = if ($arch -eq 'ARM64') { 'pnpm-win32-arm64.zip' } else { 'pnpm-win32-x64.zip' }
    Info "下载 pnpm $PnpmVersion ($pnpmAsset)…"
    $url = "https://github.com/pnpm/pnpm/releases/download/v$PnpmVersion/$pnpmAsset"
    $zip = Join-Path $Tmp 'pnpm.zip'
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    if (Test-Path $PnpmDir) { Remove-Item -Recurse -Force $PnpmDir }
    $null = New-Item -ItemType Directory -Force -Path $PnpmDir
    Expand-Archive -Path $zip -DestinationPath $PnpmDir -Force
}
$env:PATH = "$PnpmDir;$NodeDir;$env:PATH"
Info "pnpm: $(pnpm --version)"

# ---- 5. 构建 ----
Set-Location $App
Info "pnpm install（可能数分钟）…"
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Die "pnpm install 失败（exit $LASTEXITCODE）" }
Info "构建 web（next build）…"
pnpm --filter '@any-code/web' build
if ($LASTEXITCODE -ne 0) { Die "next build 失败（exit $LASTEXITCODE）" }

# ---- 6. 注册 anycode + 配置 gitBashPath ----
Copy-Item (Join-Path $App 'build\launcher.bat') (Join-Path $AnycodeHome 'bin\anycode.bat') -Force
# gitBashPath 写入 config.yaml（顶层；bash.ts 读 config，非 env）。config.yaml 不存在则跳过——
# 首装时 AnyAgent 首跑才建 config，此时 bash.ts 回退到 PortableGit 下发位置自动发现。
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
# PATH（User 作用域加 bin）— .NET 写避免 setx 1024 截断
$binDir = Join-Path $AnycodeHome 'bin'
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -notlike "*$binDir*") {
    $newPath = if ($userPath) { "$binDir;$userPath" } else { $binDir }
    [Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
}

Write-Host ''
Write-Host '✓ anycode 安装完成！' -ForegroundColor Green
Write-Host "  打开新终端（新 PowerShell/cmd），运行：anycode --web"
Write-Host "  浏览器自动打开 http://127.0.0.1:3000"

} finally {
    if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue }
}
