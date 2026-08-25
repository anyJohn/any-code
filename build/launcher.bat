@echo off
REM anycode --web: start next start (127.0.0.1 only) via private node + open browser + foreground (Ctrl+C stops).
REM Copied by install.ps1 to %USERPROFILE%\.anycode\bin\anycode.bat.
setlocal enabledelayedexpansion

set "ANYCODE_HOME=%USERPROFILE%\.anycode"
set "APP=%ANYCODE_HOME%\app"
set "WEB=%APP%\web"
set "NODE_BIN=%ANYCODE_HOME%\runtime\node"
set "NEXT=%WEB%\node_modules\.bin\next.cmd"

if not exist "%NODE_BIN%\node.exe" ( echo anycode not installed correctly: private node missing. Reinstall. & exit /b 1 )
if not exist "%NEXT%" ( echo anycode not installed correctly: web build missing. Reinstall. & exit /b 1 )

set "PATH=%WEB%\node_modules\.bin;%NODE_BIN%;%PATH%"

REM The agent bash tool's Git Bash path is read server-side from config.yaml (gitBashPath);
REM bash.ts resolveShell order: config -> PortableGit install location -> system Git. Launcher need not set env.

REM Find a free port (PowerShell try-bind; default 3000, increment if busy).
set PORT=3000
for /f %%P in ('powershell -NoProfile -Command "$p=3000; while($true){try{$l=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$p);$l.Start();$l.Stop();break}catch{$p++}}; $p"') do set PORT=%%P

set "URL=http://127.0.0.1:%PORT%"
echo Starting anycode web - %URL% (Ctrl+C to stop)

REM Open browser after a 2s delay (background, detached).
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"

cd /d "%WEB%"
call next start -H 127.0.0.1 -p %PORT%
