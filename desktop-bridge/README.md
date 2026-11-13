# ACR122U card reader bridge

The ACR122U is a PC/SC reader, which a web page cannot read. The bridge reads it and serves each tap
**on this computer only** (`127.0.0.1:47321`):

| URL | |
|---|---|
| `GET /events` | Server-Sent Events, one `card` event per tap: `{"uid":"04002baaab5c81"}` |
| `GET /status` | `{"ok":true,"reader":"...","clients":1}` |

The Office page (`pwa/src/nfcService.js` `connectPcReader`) connects to `/events`. The title bar shows
**● Card reader connected** when the bridge is running. No keyboard typing, so no Accessibility permission,
no Korean IME problem, and the browser does not need focus.

- UID: APDU `FF CA 00 00 00`, lowercase hex in card order (e.g. `04002baaab5c81`), same as `person.uid`.
- One tap = one event. Lift the card and tap again to read it again.
- Chrome/Edge may ask once to let the site access "apps and services on this device": choose **Allow**.
  (If it was blocked: click the icon left of the address bar > Site settings > allow Local network access.)

## Windows (office PCs)

Files: `windows/start-bridge.cmd`, `windows/acr122u-bridge.ps1` (copy both into the same folder).
Nothing to install: Windows PowerShell 5.1 compiles the code on start (a few seconds).

1. Plug in the ACR122U (Windows installs the driver; if Device Manager shows an unknown device, install the
   ACS ACR122U PC/SC driver).
2. Double-click `start-bridge.cmd` and leave the window open (minimized).
   `Reader: ACS ACR122 ...` must appear; tapping a card shows `Card 04... -> sent to the web page`.
3. Open the Office page; the title bar shows **● Card reader connected**. Tap a card.
4. Start it automatically (optional): Win+R, `shell:startup`, put a shortcut to `start-bridge.cmd` there.

Options: `-DryRun` (log only), `-Keyboard` (also type UID + Enter into the focused window).

If Windows shows "Installing device driver software... Smart card" on every tap, turn off Smart Card Plug and
Play (gpedit: Computer Configuration > Administrative Templates > Windows Components > Smart Card >
"Turn on Smart Card Plug and Play service" = Disabled).

## macOS

```sh
cd desktop-bridge
clang -O2 -o acr122u-bridge acr122u-bridge.c -framework PCSC -framework ApplicationServices -framework Carbon
./acr122u-bridge              # keep the terminal open
```

Options: `--dry-run` (log only), `--keyboard` (also type UID + Enter; needs Accessibility permission).
