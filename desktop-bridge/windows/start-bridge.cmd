@echo off
rem PUSAN MART: ACR122U card reader bridge for the Office web page. Keep this window open (minimize it).
title PUSAN MART ACR122U bridge
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0acr122u-bridge.ps1" %*
pause
