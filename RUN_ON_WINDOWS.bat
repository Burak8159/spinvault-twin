@echo off
setlocal
title SpinVault Twin

echo Starting SpinVault Twin for Windows...
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_local_windows.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo SpinVault Twin could not start. Read the error above.
  echo.
  pause
)

exit /b %EXIT_CODE%
