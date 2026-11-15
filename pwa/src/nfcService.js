(() => {
  const eventName = "nfc-tag";

  // ---------- UID formats ----------

  // Match the old Android format: lowercase hex, no separators ("04:D0:98" -> "04d098").
  function normalizeUid(uid) {
    return String(uid || "").trim().replace(/[\s:-]/g, "").toLowerCase();
  }

  // USB/Bluetooth NFC readers in keyboard mode often type the UID as a 10-digit decimal
  // number instead of hex. "dec-reversed" (the most common) reads the 4 UID bytes
  // little-endian; "dec" reads them in card order. "hex" passes the value through.
  const READER_FORMATS = ["auto", "hex", "dec-reversed", "dec"];

  function getReaderFormat() {
    try {
      const value = localStorage.getItem("pusanReaderFormat");
      return READER_FORMATS.includes(value) ? value : "auto";
    } catch {
      return "auto";
    }
  }

  function setReaderFormat(value) {
    try {
      if (READER_FORMATS.includes(value)) localStorage.setItem("pusanReaderFormat", value);
    } catch {
      // storage unavailable: keep default
    }
  }

  function decimalToHex(digits, reversed) {
    let hex = BigInt(digits).toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    if (hex.length < 8) hex = hex.padStart(8, "0");
    if (!reversed) return hex;
    return hex.match(/../g).reverse().join("");
  }

  function readerUidToHex(raw, format = getReaderFormat()) {
    const value = String(raw || "").trim();
    if (format === "hex") return normalizeUid(value);
    const digitsOnly = /^\d+$/.test(value);
    if (format === "dec-reversed" && digitsOnly) return decimalToHex(value, true);
    if (format === "dec" && digitsOnly) return decimalToHex(value, false);
    // auto: a 10-digit number is a decimal UID (4 bytes, little-endian); anything else is hex.
    if (format === "auto" && digitsOnly && value.length === 10) return decimalToHex(value, true);
    return normalizeUid(value);
  }

  // ---------- events ----------

  function listenForNfc(handler) {
    const listener = (event) => {
      const detail = event.detail;
      if (detail?.uid) handler({ ...detail, uid: normalizeUid(detail.uid) });
    };
    window.addEventListener(eventName, listener);
    return () => window.removeEventListener(eventName, listener);
  }

  function dispatchNfcTag(detail) {
    flashPhoneBadge(`✓ 카드 읽음 ${normalizeUid(detail?.uid)}`, "#1565C0");
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  function dispatchManualUid(uid) {
    dispatchNfcTag({ uid: uid.trim(), source: "manual", timestamp: Date.now() });
  }

  // ---------- phone NFC (Android native bridge or Web NFC) ----------

  let webNfcAbort = null;

  function phoneNfcSupport() {
    if (window.PusanMartNfc?.startScan) return "android-native";
    if ("NDEFReader" in window && window.NDEFReader) return window.isSecureContext ? "web-nfc" : "web-nfc-insecure";
    return "none";
  }

  async function startNfcScan() {
    if (window.PusanMartNfc?.startScan) {
      window.PusanMartNfc.startScan();
      return { mode: "android-native" };
    }

    if ("NDEFReader" in window && window.NDEFReader) {
      if (!window.isSecureContext) return { mode: "unsupported", reason: "Web NFC는 HTTPS 주소에서만 동작합니다." };
      stopWebNfc();
      const controller = new AbortController();
      webNfcAbort = controller;
      const reader = new window.NDEFReader();
      reader.addEventListener(
        "reading",
        (event) => {
          if (event.serialNumber) {
            dispatchNfcTag({ uid: event.serialNumber, source: "web-nfc", timestamp: Date.now() });
          }
        },
        { signal: controller.signal },
      );
      reader.addEventListener(
        "readingerror",
        () => {
          flashPhoneBadge("✕ 카드를 읽지 못했습니다. 다시 대주세요.", "#C62828");
          window.dispatchEvent(new CustomEvent("nfc-error", { detail: { message: "카드를 읽지 못했습니다. 다시 대주세요." } }));
        },
        { signal: controller.signal },
      );
      try {
        await reader.scan({ signal: controller.signal });
      } catch (error) {
        stopWebNfc();
        if (error?.name === "NotAllowedError") {
          throw new Error("NFC 권한이 거부되었습니다. 브라우저 사이트 설정에서 NFC를 허용하세요.");
        }
        if (error?.name === "NotReadableError") {
          throw new Error("폰의 NFC가 꺼져 있습니다. 설정에서 NFC를 켜세요.");
        }
        throw error;
      }
      return { mode: "web-nfc" };
    }

    return { mode: "unsupported" };
  }

  function stopWebNfc() {
    webNfcAbort?.abort();
    webNfcAbort = null;
  }

  function stopNfcScan() {
    window.PusanMartNfc?.stopScan?.();
    stopWebNfc();
  }

  // ---------- keep phone NFC running + on-screen status ----------
  // While the page is NOT scanning, Android itself reads the card and shows "Empty tag" (the student cards
  // hold no NDEF data). So the page keeps the scan on: it starts as soon as it is allowed, retries on every
  // touch after a failure, restarts when the page comes back to the front, and shows its state in a badge.
  // Web NFC can ask for permission only inside a touch, so without permission it waits for the next touch.

  let phoneState = "off"; // off | starting | on | error
  let phoneMessage = "";
  let phoneWanted = () => true;
  let phoneBadge = null;
  let nfcPermission = "prompt";

  function isPhone() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  // Every tap briefly shows on the badge, so it is clear the card reached the page even when the open
  // screen does nothing with it.
  let flashText = "";
  let flashColor = "";
  let flashTimer = null;
  function flashPhoneBadge(text, color) {
    if (!phoneBadge) return;
    flashText = text;
    flashColor = color;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashText = "";
      renderPhoneBadge();
    }, 2500);
    renderPhoneBadge();
  }

  function renderPhoneBadge() {
    if (!phoneBadge) return;
    if (flashText) {
      phoneBadge.hidden = false;
      phoneBadge.textContent = flashText;
      phoneBadge.style.background = flashColor;
      return;
    }
    const support = phoneNfcSupport();
    let text;
    let color;
    if (support === "none") {
      text = "✕ 이 브라우저는 NFC를 지원하지 않습니다. Android Chrome으로 여세요.";
      color = "#C62828";
    } else if (support === "web-nfc-insecure") {
      text = "✕ NFC는 HTTPS 주소에서만 동작합니다.";
      color = "#C62828";
    } else if (!phoneWanted()) {
      phoneBadge.hidden = true;
      return;
    } else if (phoneState === "on") {
      text = "● NFC 대기 중";
      color = "#2E7D32";
    } else if (phoneState === "starting") {
      text = "… NFC 켜는 중";
      color = "#757575";
    } else if (phoneState === "error") {
      text = `✕ ${phoneMessage || "NFC를 켜지 못했습니다."} (터치해서 다시 시도)`;
      color = "#C62828";
    } else {
      text = "○ 화면을 터치하면 NFC가 켜집니다";
      color = "#E65100";
    }
    phoneBadge.hidden = false;
    phoneBadge.textContent = text;
    phoneBadge.style.background = color;
  }

  function setPhoneState(state, message = "") {
    phoneState = state;
    phoneMessage = message;
    renderPhoneBadge();
  }

  function ensurePhoneNfc(fromTouch = false) {
    const support = phoneNfcSupport();
    if (support !== "android-native" && support !== "web-nfc") return renderPhoneBadge();
    if (!phoneWanted()) {
      if (phoneState === "on" || phoneState === "starting") {
        stopNfcScan();
        setPhoneState("off");
      }
      return renderPhoneBadge();
    }
    if (phoneState === "on" || phoneState === "starting") return;
    // Without permission, scan() fails unless it is called inside a touch: wait for one.
    if (support === "web-nfc" && !fromTouch && nfcPermission !== "granted") return setPhoneState("off");
    setPhoneState("starting");
    startNfcScan()
      .then((result) => {
        if (result.mode === "unsupported") setPhoneState("error", result.reason || "NFC를 사용할 수 없습니다.");
        else setPhoneState("on");
      })
      .catch((error) => {
        // NotAllowedError without a "denied" setting means the browser did not count it as a user tap:
        // wait for the next tap instead of telling the user to change settings.
        if (error?.name === "NotAllowedError" || /권한/.test(error?.message || "")) {
          if (nfcPermission !== "denied") return setPhoneState("off");
          return setPhoneState(
            "error",
            "이 사이트의 NFC가 차단되어 있습니다. 주소창 왼쪽 아이콘 → 권한 → NFC 허용 후 새로고침하세요.",
          );
        }
        setPhoneState("error", error?.message || "NFC를 켜지 못했습니다.");
      });
  }

  // isWanted(): whether the page wants the phone reader right now (e.g. logged in). Call the returned
  // refresh() whenever that may have changed.
  function keepPhoneNfc(isWanted) {
    if (typeof isWanted === "function") phoneWanted = isWanted;
    const support = phoneNfcSupport();
    if (!phoneBadge && (support !== "none" || isPhone())) {
      phoneBadge = document.createElement("div");
      phoneBadge.className = "pusan-nfc-badge";
      phoneBadge.style.cssText =
        "position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:2147483000;max-width:calc(100% - 32px);" +
        "padding:6px 12px;border-radius:14px;color:#fff;font:600 12px/1.3 sans-serif;text-align:center;" +
        "box-shadow:0 2px 6px rgba(0,0,0,.3);cursor:pointer;pointer-events:auto;";
      phoneBadge.hidden = true;
      document.body.appendChild(phoneBadge);
    }
    if (support === "android-native" || support === "web-nfc") {
      // Chrome counts a touch as a user action only when the finger lifts (pointerup / click), not on
      // pointerdown, and Web NFC needs that to ask for permission.
      const onUserAction = () => ensurePhoneNfc(true);
      document.addEventListener("pointerup", onUserAction, true);
      document.addEventListener("click", onUserAction, true);
      document.addEventListener("keydown", onUserAction, true);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        // Chrome can drop the scan while the screen was off or another app was in front: start it again.
        if (support === "web-nfc" && phoneState === "on") phoneState = "off";
        ensurePhoneNfc(false);
      });
      if (support === "web-nfc" && navigator.permissions?.query) {
        navigator.permissions
          .query({ name: "nfc" })
          .then((status) => {
            nfcPermission = status.state;
            status.onchange = () => {
              nfcPermission = status.state;
              ensurePhoneNfc(false);
            };
            ensurePhoneNfc(false);
          })
          .catch(() => ensurePhoneNfc(false));
      }
    }
    ensurePhoneNfc(false);
    return { refresh: () => ensurePhoneNfc(false) };
  }

  // ---------- USB / Bluetooth reader in keyboard (HID) mode ----------
  // Readers "type" the UID very fast and finish with Enter. Human typing is much slower,
  // so a fast burst of >= 6 hex characters ending in Enter is treated as a card (limits below).

  // Some readers (and Bluetooth ones) type slower than 60ms per key: allow gaps up to 250ms, but the
  // whole burst must average <= 100ms per key, which people typing by hand do not reach.
  const MAX_KEY_GAP_MS = 250;
  const MAX_AVG_GAP_MS = 100;
  const MIN_UID_LENGTH = 6;
  let readerEnabled = () => false;
  let buffer = "";
  let lastKeyAt = 0;
  let firstKeyAt = 0;

  function enableKeyboardReader(isActive) {
    readerEnabled = isActive;
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (!readerEnabled()) {
        buffer = "";
        return;
      }
      const now = performance.now();
      if (now - lastKeyAt > MAX_KEY_GAP_MS) buffer = "";
      if (!buffer) firstKeyAt = now;
      lastKeyAt = now;

      const isEnd = event.key === "Enter" || event.key === "Tab" || event.code === "Enter" || event.code === "NumpadEnter";
      if (isEnd) {
        const raw = buffer;
        buffer = "";
        const avgGap = raw.length > 1 ? (now - firstKeyAt) / raw.length : 0;
        if (raw.length >= MIN_UID_LENGTH && avgGap <= MAX_AVG_GAP_MS) {
          event.preventDefault();
          event.stopPropagation();
          // Clear any characters the reader typed into a focused text field.
          const target = event.target;
          // Case-insensitive: some screens upper-case what is typed into UID boxes.
          if (target instanceof HTMLInputElement && target.value.toLowerCase().endsWith(raw.toLowerCase())) {
            target.value = target.value.slice(0, -raw.length);
            target.dispatchEvent(new Event("input", { bubbles: true }));
          }
          dispatchNfcTag({ uid: readerUidToHex(raw), raw, source: "usb-reader", timestamp: Date.now() });
        }
        return;
      }
      // With the Korean (or another) IME on, a-f arrive as Hangul ('ㅁ', 'ㅠ' ...) or "Process":
      // fall back to the physical key (event.code) so the UID is still read.
      const code = /^(?:Key([A-Fa-f])|Digit(\d)|Numpad(\d))$/.exec(event.code || "");
      const ch = /^[0-9a-fA-F]$/.test(event.key) ? event.key : code ? code[1] || code[2] || code[3] : null;
      if (ch) buffer += ch;
      else if (event.key.length === 1 && !/[\s:-]/.test(event.key)) buffer = "";
    },
    true,
  );

  // ---------- PC/SC reader (ACR122U) via the desktop bridge ----------
  // desktop-bridge/ (acr122u-bridge on macOS, start-bridge.cmd on Windows) reads the reader and serves each
  // tap as a Server-Sent Event on this computer only. EventSource reconnects by itself, so the bridge can be
  // started before or after the page. onStatus(true|false) reports whether the bridge is connected.

  const PC_BRIDGE_URL = "http://127.0.0.1:47321/events";
  let pcBridge = null;

  // ---------- one-step install hint ----------
  // When the bridge does not answer a few seconds after the page opens on a Windows PC or a Mac, show a small
  // card with the one line that installs it (bridge/install.ps1, bridge/install.sh): it then starts by itself at
  // every sign-in, so staff never copy files or keep a window open. It cannot be dismissed: it stays until the
  // bridge connects, and comes back if the bridge stops for more than a few seconds.
  let bridgeHint = null;
  let bridgeHintTimer = null;

  function bridgeInstall() {
    const site =
      location.protocol === "https:" && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)
        ? location.origin
        : "https://smeag-estore.vercel.app";
    const base = site + "/bridge";
    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) {
      return {
        // No "$" in the line: pasted into a PowerShell window instead of Win+R, the outer PowerShell would expand
        // $b inside the double quotes to nothing. sv/irm with literal strings work from Win+R, cmd and PowerShell.
        cmd: `powershell -NoProfile -ExecutionPolicy Bypass -c "[Net.ServicePointManager]::SecurityProtocol='Tls12';sv b '${base}';irm '${base}/install.ps1'|iex"`,
        steps: ["아래 [명령 복사]를 누릅니다", "키보드에서 Windows 키 + R", "Ctrl + V 붙여넣기 후 Enter"],
      };
    }
    // iPadOS also says "Macintosh"; it has touch points, a real Mac does not.
    if (/Macintosh|Mac OS X/i.test(ua) && !(navigator.maxTouchPoints > 1)) {
      return {
        cmd: `curl -fsSL ${base}/install.sh | B=${base} sh`,
        steps: ["아래 [명령 복사]를 누릅니다", "터미널 앱을 엽니다 (Cmd + Space → 터미널)", "Cmd + V 붙여넣기 후 Enter"],
      };
    }
    return null;
  }

  function hideBridgeHint() {
    clearTimeout(bridgeHintTimer);
    bridgeHintTimer = null;
    bridgeHint?.remove();
    bridgeHint = null;
  }

  function showBridgeHint() {
    const info = bridgeInstall();
    if (!info || bridgeHint || !document.body) return;

    const el = (tag, css, text) => {
      const n = document.createElement(tag);
      if (css) n.style.cssText = css;
      if (text != null) n.textContent = text;
      return n;
    };
    const box = el(
      "div",
      "position:fixed;right:16px;bottom:16px;z-index:99999;width:min(380px,calc(100vw - 32px));background:#fff;color:#17201d;" +
        "border:1px solid #cfd8d4;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:16px;" +
        "font:14px/1.5 system-ui,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;",
    );
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "카드 리더 프로그램 설치");
    box.appendChild(el("div", "font-weight:700;font-size:15px;margin-bottom:4px", "카드 리더 프로그램이 꺼져 있습니다"));
    box.appendChild(
      el("div", "color:#5a6762;font-size:13px;margin-bottom:10px", "이 PC에서 한 번만 설치하면, 앞으로는 PC를 켤 때 자동으로 켜집니다."),
    );
    const ol = el("ol", "margin:0 0 10px;padding-left:20px");
    info.steps.forEach((s) => ol.appendChild(el("li", "", s)));
    box.appendChild(ol);
    const code = el(
      "textarea",
      "width:100%;box-sizing:border-box;height:58px;resize:none;font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;" +
        "border:1px solid #cfd8d4;border-radius:6px;padding:6px;background:#f3f5f4;color:#17201d;",
    );
    code.readOnly = true;
    code.value = info.cmd;
    box.appendChild(code);
    const row = el("div", "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap");
    const btn = (label, primary) =>
      el(
        "button",
        "font:inherit;font-size:13px;padding:7px 12px;border-radius:8px;cursor:pointer;" +
          (primary ? "background:#0f7a5c;color:#fff;border:1px solid #0f7a5c;" : "background:#fff;color:#17201d;border:1px solid #cfd8d4;"),
        label,
      );
    const copy = btn("명령 복사", true);
    copy.type = "button";
    copy.addEventListener("click", () => {
      const done = () => (copy.textContent = "복사됨 ✓");
      const fallback = () => {
        code.focus();
        code.select();
        try {
          if (document.execCommand("copy")) done();
        } catch {}
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(info.cmd).then(done, fallback);
      else fallback();
    });
    row.append(copy);
    box.appendChild(row);
    box.appendChild(
      el("div", "color:#5a6762;font-size:12px;margin-top:8px", "카드 리더를 쓰려면 설치가 필요합니다. 설치가 끝나면 이 안내는 저절로 사라집니다. 브라우저가 기기 접근을 물으면 [허용]을 누르세요."),
    );
    bridgeHint = box;
    document.body.appendChild(box);
  }

  function connectPcReader(onStatus) {
    if (pcBridge || typeof EventSource === "undefined") return;
    pcBridge = new EventSource(PC_BRIDGE_URL);
    let bridgeUp = false;
    bridgeHintTimer = setTimeout(() => {
      bridgeHintTimer = null;
      if (!bridgeUp) showBridgeHint();
    }, 6000);
    pcBridge.addEventListener("open", () => {
      bridgeUp = true;
      hideBridgeHint();
      onStatus?.(true);
    });
    pcBridge.addEventListener("error", () => {
      bridgeUp = false;
      if (!bridgeHintTimer && !bridgeHint) {
        bridgeHintTimer = setTimeout(() => {
          bridgeHintTimer = null;
          if (!bridgeUp) showBridgeHint();
        }, 6000);
      }
      onStatus?.(false);
    });
    pcBridge.addEventListener("card", (event) => {
      let data = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data?.uid) dispatchNfcTag({ uid: data.uid, source: "pc-reader", timestamp: Date.now() });
    });
  }

  window.PusanNfc = {
    READER_FORMATS,
    connectPcReader,
    dispatchManualUid,
    dispatchNfcTag,
    enableKeyboardReader,
    getReaderFormat,
    keepPhoneNfc,
    listenForNfc,
    normalizeUid,
    phoneNfcSupport,
    readerUidToHex,
    setReaderFormat,
    startNfcScan,
    stopNfcScan,
  };
})();
