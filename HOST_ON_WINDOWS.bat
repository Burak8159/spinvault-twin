@echo off
setlocal
title SpinVault Twin — spinvault.biz

echo Starting SpinVault Twin for https://spinvault.biz ...
echo Keep this window open. The public site is only live while this PC is running.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_local_windows.ps1" -PublicDomain spinvault.biz -Tunnel
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo SpinVault Twin could not start. Read the error above.
  echo See docs\HOSTING_WINDOWS.md for the Cloudflare domain steps.
  echo.
  pause
)

exit /b %EXIT_CODE%
