# ACR122U keyboard bridge

The ACR122U is a PC/SC reader. It does not type the card UID, so the web screens (`/office/`, `/mart/`, `/cafe/`)
never see a tap. This small program reads the reader and types `UID + Enter` into the focused window, like a
keyboard-mode reader. `pwa/src/nfcService.js` then handles the tap on every Office tab.

- UID: APDU `FF CA 00 00 00`, lowercase hex in card order (e.g. `04002baaab5c81`), same as `person.uid`.
- Korean input is switched to English while the UID is typed, then restored.
- One tap = one input. Lift the card and tap again to read it again.
- Keep the browser (Office page) in front: the UID is typed into whatever window has focus.

## Windows (office PCs)

Files: `windows/start-bridge.cmd`, `windows/acr122u-keyboard.ps1` (copy both into the same folder).
Nothing to install: Windows PowerShell 5.1 compiles the code on start (takes a few seconds).

1. Plug in the ACR122U. Windows normally installs the driver by itself; if Device Manager shows an unknown
   device, install the ACS ACR122U PC/SC driver.
2. Test first: open PowerShell in the folder and run
   `powershell -ExecutionPolicy Bypass -File acr122u-keyboard.ps1 -DryRun`
   then tap a card. You should see `Reader: ACS ACR122 ...` and `Card 04....` lines. Ctrl+C to stop.
3. Double-click `start-bridge.cmd` and leave the black window open (minimized).
   Open the Office page in Chrome/Edge and tap a card.
4. Start it automatically (optional): press Win+R, type `shell:startup`, and put a shortcut to
   `start-bridge.cmd` in that folder.

If Windows shows "Installing device driver software... Smart card" on every tap, turn off
Smart Card Plug and Play (gpedit: Computer Configuration > Administrative Templates > Windows Components >
Smart Card > "Turn on Smart Card Plug and Play service" = Disabled).

## macOS

`acr122u-keyboard.c` (needs Xcode command line tools):

```sh
clang -O2 -o acr122u-keyboard acr122u-keyboard.c -framework PCSC -framework ApplicationServices -framework Carbon
./acr122u-keyboard --dry-run   # logs cards only, types nothing
./acr122u-keyboard             # types into the focused window
```

The app that runs it (e.g. Terminal) needs System Settings > Privacy & Security > Accessibility.
