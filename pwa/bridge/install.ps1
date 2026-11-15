# PUSAN MART card reader bridge: one-step installer for Windows.
# The Mart/Office/Cafe page shows this one line when the reader program is not running (Win+R, paste, Enter):
#   powershell -NoProfile -ExecutionPolicy Bypass -c "[Net.ServicePointManager]::SecurityProtocol='Tls12';sv b 'https://smeag-estore.vercel.app/bridge';irm 'https://smeag-estore.vercel.app/bridge/install.ps1'|iex"
# It copies the bridge to %LOCALAPPDATA%\PusanMartBridge, starts it hidden (no window to close by mistake),
# keeps it running (restarts within seconds if it stops), and starts it again at every Windows sign-in.
# Undo: same line with uninstall.ps1 instead of install.ps1.
$ErrorActionPreference = 'Stop'
try {
  [Net.ServicePointManager]::SecurityProtocol = 'Tls12'
  if (-not $b) { $b = 'https://smeag-estore.vercel.app/bridge' }
  $dir = Join-Path $env:LOCALAPPDATA 'PusanMartBridge'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-Host 'PUSAN MART card reader: installing...'
  Invoke-WebRequest -UseBasicParsing "$b/acr122u-bridge.ps1" -OutFile (Join-Path $dir 'acr122u-bridge.ps1')

  $runner = @'
# Keeps the PUSAN MART card bridge running (started hidden at sign-in by the HKCU Run key).
$ErrorActionPreference = 'Continue'
$m = New-Object System.Threading.Mutex($false, 'Local\PusanMartBridgeRunner')
if (-not $m.WaitOne(0)) { exit }
$dir = $PSScriptRoot
$bridge = Join-Path $dir 'acr122u-bridge.ps1'
$log = Join-Path $dir 'bridge.log'
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
# Pick up a newer bridge from the site when online; keep the current one otherwise.
try {
  Invoke-WebRequest -UseBasicParsing '__BASE__/acr122u-bridge.ps1' -OutFile "$bridge.new" -TimeoutSec 20
  if ((Get-Item "$bridge.new").Length -gt 1000) { Move-Item -Force "$bridge.new" $bridge }
} catch { Remove-Item -ErrorAction SilentlyContinue "$bridge.new" }
while ($true) {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) { Remove-Item -ErrorAction SilentlyContinue $log }
  $up = $false
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:47321/status' | Out-Null; $up = $true } catch { }
  if (-not $up) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bridge *>> $log }
  Start-Sleep -Seconds 5
}
'@
  Set-Content -Encoding UTF8 -Path (Join-Path $dir 'run-bridge.ps1') -Value $runner.Replace('__BASE__', $b)

  $cmd = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $dir 'run-bridge.ps1') + '"'
  Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'PusanMartBridge' -Value $cmd

  # An older manual setup (Startup shortcut to start-bridge.cmd) would open a second window: remove it.
  $old = Join-Path ([Environment]::GetFolderPath('Startup')) 'PUSAN MART card bridge.lnk'
  if (Test-Path $old) { Remove-Item -Force $old }

  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $dir 'run-bridge.ps1'))
  $ok = $false
  for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
    Start-Sleep -Seconds 1
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:47321/status' | Out-Null; $ok = $true } catch { }
  }
  if ($ok) { Write-Host 'Done. The card reader program is running and will start by itself.' -ForegroundColor Green; Start-Sleep -Seconds 3 }
  else { Write-Host "Installed, but it did not answer yet. Log: $dir\bridge.log" -ForegroundColor Yellow; Start-Sleep -Seconds 15 }
} catch {
  Write-Host ('Install failed: ' + $_.Exception.Message) -ForegroundColor Red
  Read-Host 'Press Enter to close'
}
