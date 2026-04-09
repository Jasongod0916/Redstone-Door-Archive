@echo off
setlocal

set "PORT=8934"
set "ROOT=%~dp0"
set "PAGE=door-catalog-viewer.html"

echo Starting local server for %ROOT%
echo.
echo Simulator URL:
echo   http://localhost:%PORT%/%PAGE%
echo.
echo Admin URL:
echo   http://localhost:%PORT%/door-admin.html
echo.
echo Press Ctrl+C in this window to stop the server.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%local-server.ps1" -Port %PORT% -DefaultPage "%PAGE%"

endlocal
