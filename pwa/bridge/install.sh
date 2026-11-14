#!/bin/sh
# PUSAN MART card reader bridge: one-step installer for macOS.
# The Mart/Office/Cafe page shows this line when the reader program is not running (paste into Terminal):
#   curl -fsSL https://smeag-estore.vercel.app/bridge/install.sh | sh
# It downloads the bridge (Apple Silicon and Intel) to ~/Library/Application Support/PusanMartBridge and runs it
# as a LaunchAgent: no window, restarted if it stops, started again at every login.
# Undo: curl -fsSL https://smeag-estore.vercel.app/bridge/install.sh | sh -s -- --remove
set -e
B="${B:-https://smeag-estore.vercel.app/bridge}"
LABEL=com.pusanmart.acr122u-bridge
APP_DIR="$HOME/Library/Application Support/PusanMartBridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/pusan-acr122u-bridge.log"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "$1" = "--remove" ]; then
  rm -f "$PLIST"; rm -rf "$APP_DIR"
  echo "PUSAN MART card reader program removed."
  exit 0
fi
mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
curl -fsSL "$B/acr122u-bridge-macos" -o "$APP_DIR/acr122u-bridge.new"
chmod +x "$APP_DIR/acr122u-bridge.new"
mv -f "$APP_DIR/acr122u-bridge.new" "$APP_DIR/acr122u-bridge"
pkill -x acr122u-bridge 2>/dev/null && sleep 1 || true

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$APP_DIR/acr122u-bridge</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>StandardOutPath</key><string>$LOG</string>
</dict>
</plist>
PL
launchctl bootstrap "$DOMAIN" "$PLIST"
i=0
while [ $i -lt 10 ]; do
  if curl -s -m 2 http://127.0.0.1:47321/status >/dev/null; then
    echo "Done. The card reader program is running and will start by itself at every login."
    exit 0
  fi
  sleep 1; i=$((i + 1))
done
echo "Installed, but it did not answer yet. Log: $LOG" >&2
