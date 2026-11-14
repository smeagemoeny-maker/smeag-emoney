@echo off
rem PUSAN MART: start the ACR122U card reader bridge automatically when this user signs in to Windows.
rem Double-click once. It adds a shortcut to the Startup folder (window starts minimized) and starts the bridge now.
rem To undo: double-click uninstall-autostart.cmd.
setlocal
set "BRIDGE_DIR=%~dp0"
if not exist "%BRIDGE_DIR%start-bridge.cmd" ( echo start-bridge.cmd is missing next to this file. & pause & exit /b 1 )
if not exist "%BRIDGE_DIR%acr122u-bridge.ps1" ( echo acr122u-bridge.ps1 is missing next to this file. & pause & exit /b 1 )

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'PUSAN MART card bridge.lnk';" ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk);" ^
  "$s.TargetPath = Join-Path $env:BRIDGE_DIR 'start-bridge.cmd';" ^
  "$s.WorkingDirectory = $env:BRIDGE_DIR;" ^
  "$s.WindowStyle = 7;" ^
  "$s.Description = 'PUSAN MART ACR122U card reader bridge';" ^
  "$s.Save(); Write-Host ('Added: ' + $lnk)"
if errorlevel 1 ( echo Could not create the Startup shortcut. & pause & exit /b 1 )

rem Start it now unless it is already running.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:47321/status | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "PUSAN MART ACR122U bridge" /min "%BRIDGE_DIR%start-bridge.cmd"
  echo The bridge is starting now ^(minimized window^).
) else (
  echo The bridge is already running.
)
echo.
echo Done. From now on the bridge starts by itself when you sign in to Windows.
echo Keep this folder where it is: the shortcut points to it.
pause
