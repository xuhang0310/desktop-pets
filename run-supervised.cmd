@echo off
set ELECTRON_RUN_AS_NODE=
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~2\scripts\voice-host.ps1" -ElectronPath "%~1" -AppDirectory "%~2" >> "%~3" 2>&1
