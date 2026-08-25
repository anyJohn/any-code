@echo off
REM anycode --web：私有 node 起 next start（仅 127.0.0.1）+ 开浏览器 + 前台（Ctrl+C 停止）。
REM 由 install.ps1 复制到 %USERPROFILE%\.anycode\bin\anycode.bat。
setlocal enabledelayedexpansion

set "ANYCODE_HOME=%USERPROFILE%\.anycode"
set "APP=%ANYCODE_HOME%\app"
set "WEB=%APP%\web"
set "NODE_BIN=%ANYCODE_HOME%\runtime\node"
set "NEXT=%WEB%\node_modules\.bin\next.cmd"

if not exist "%NODE_BIN%\node.exe" ( echo anycode 未正确安装：缺私有 node。请重装。 & exit /b 1 )
if not exist "%NEXT%" ( echo anycode 未正确安装：缺 web 构建。请重装。 & exit /b 1 )

set "PATH=%WEB%\node_modules\.bin;%NODE_BIN%;%PATH%"

REM agent bash 工具的 Git Bash 路径由 server 端从 config.yaml 的 gitBashPath 读
REM （bash.ts resolveShell：config → PortableGit 下发位置 → 系统 Git），launcher 无需设 env。

REM 找空闲端口（PowerShell try-bind，DEC-091）
set PORT=3000
for /f %%P in ('powershell -NoProfile -Command "$p=3000; while($true){try{$l=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$p);$l.Start();$l.Stop();break}catch{$p++}}; $p"') do set PORT=%%P

set "URL=http://127.0.0.1:%PORT%"
echo 启动 anycode web → %URL% （Ctrl+C 停止）

REM 服务就绪后开浏览器（后台延时 2s）
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"

cd /d "%WEB%"
call next start -H 127.0.0.1 -p %PORT%
