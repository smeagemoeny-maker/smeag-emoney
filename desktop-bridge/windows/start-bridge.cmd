@echo off
rem PUSAN MART: ACR122U card reader -> keyboard. Keep this window open (minimize it).
title PUSAN MART ACR122U bridge
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0acr122u-keyboard.ps1" %*
pause
