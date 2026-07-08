@echo off
setlocal
cd /d "%~dp0"

set "PORT=8787"
set "NODE_EXE=node"
set "BUNDLED_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

where node >nul 2>nul
if errorlevel 1 (
  if exist "%BUNDLED_NODE%" (
    set "NODE_EXE=%BUNDLED_NODE%"
  ) else (
    echo Node.js was not found.
    echo Install Node.js or run from a machine with Codex's bundled runtime.
    pause
    exit /b 1
  )
)

echo.
echo RMetS voting app
echo ----------------
echo Presenter dashboard on this laptop:
echo   http://localhost:%PORT%/presenter.html
echo.
echo Audience join URLs to try from a phone on the same network:
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | ForEach-Object { '  http://' + $_.IPAddress + ':%PORT%/' }"
echo.
echo If Windows asks whether to allow Node.js through the firewall, choose Allow.
echo Keep this window open during the session.
echo.
"%NODE_EXE%" server.mjs --host 0.0.0.0 --port %PORT%
pause
