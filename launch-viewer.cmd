@echo off
set ROOT=%~dp0
set PORT=8080

powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue)) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 (
  start "Coralogix Viewer" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%serve.ps1" -Port %PORT%
  timeout /t 1 /nobreak >nul
)

start "" "http://localhost:%PORT%/"
