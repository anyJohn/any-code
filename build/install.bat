@echo off
REM anycode Windows 安装入口（cmd / 双击均可）。
REM 薄 shim：PowerShell 拉取并执行 install.ps1（真正逻辑在 ps1，bat 仅满足"bat 脚本"入口）。
powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -useb https://raw.githubusercontent.com/anyJohn/any-code/main/build/install.ps1 | iex"
