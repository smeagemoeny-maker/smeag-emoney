#!/bin/sh
# PUSAN MART: run the ACR122U card reader bridge in the background whenever this user is logged in (macOS).
#   sh macos/install-autostart.sh            install (or update) and start now
#   sh macos/install-autostart.sh --remove   stop it and remove the autostart
# The program is copied to ~/Library/Application Support/PusanMartBridge, launchd restarts it if it stops,
# and its log is ~/Library/Logs/pusan-acr122u-bridge.log. No terminal window is needed.
set -e
LABEL=com.pusanmart.acr122u-bridge
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$HOME/Library/Application Support/PusanMartBridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/pusan-acr122u-bridge.log"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "$1" = "--remove" ]; then
  rm -f "$PLIST"
  echo "Autostart removed. (Program left in $APP_DIR)"
  exit 0
fi

mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
if command -v clang >/dev/null 2>&1 && [ -f "$SRC_DIR/acr122u-bridge.c" ]; then
  clang -O2 -o "$APP_DIR/acr122u-bridge" "$SRC_DIR/acr122u-bridge.c" \
    -framework PCSC -framework ApplicationServices -framework Carbon
elif [ -x "$SRC_DIR/acr122u-bridge" ]; then
  cp "$SRC_DIR/acr122u-bridge" "$APP_DIR/acr122u-bridge"
else
  echo "No compiler (run: xcode-select --install) and no built acr122u-bridge next to the source." >&2
  exit 1
fi

# A bridge started by hand in a terminal holds the port; stop it so the background one can take over.
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
sleep 2
if curl -s -m 3 http://127.0.0.1:47321/status; then
  echo
  echo "Bridge is running and will start by itself at every login. Log: $LOG"
else
  echo "Started, but /status did not answer yet. Check the log: $LOG" >&2
fi
