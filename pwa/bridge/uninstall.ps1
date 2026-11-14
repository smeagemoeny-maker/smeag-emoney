# PUSAN MART card reader bridge: remove what install.ps1 set up (Windows).
#   powershell -NoProfile -ExecutionPolicy Bypass -c "irm https://smeag-estore.vercel.app/bridge/uninstall.ps1|iex"
$dir = Join-Path $env:LOCALAPPDATA 'PusanMartBridge'
Remove-ItemProperty -ErrorAction SilentlyContinue -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'PusanMartBridge'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*PusanMartBridge*' } |
  ForEach-Object { Stop-Process -Force -Id $_.ProcessId -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $dir
Write-Host 'PUSAN MART card reader program removed.'
Start-Sleep -Seconds 3
