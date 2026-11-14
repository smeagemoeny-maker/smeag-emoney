@echo off
rem PUSAN MART: stop starting the card reader bridge at sign-in (the running window is left open).
powershell -NoProfile -Command "$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'PUSAN MART card bridge.lnk'; if (Test-Path $lnk) { Remove-Item $lnk; 'Removed: ' + $lnk } else { 'Autostart was not set up.' }"
pause
