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
        () => window.dispatchEvent(new CustomEvent("nfc-error", { detail: { message: "카드를 읽지 못했습니다. 다시 대주세요." } })),
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

  // ---------- USB / Bluetooth reader in keyboard (HID) mode ----------
  // Readers "type" the UID very fast and finish with Enter. Human typing is much slower,
  // so a burst of >= 6 characters with < 60ms gaps ending in Enter is treated as a card.

  const MAX_KEY_GAP_MS = 60;
  const MIN_UID_LENGTH = 6;
  let readerEnabled = () => false;
  let buffer = "";
  let lastKeyAt = 0;

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
      lastKeyAt = now;

      if (event.key === "Enter" || event.key === "Tab") {
        const raw = buffer;
        buffer = "";
        if (raw.length >= MIN_UID_LENGTH) {
          event.preventDefault();
          event.stopPropagation();
          // Clear any characters the reader typed into a focused text field.
          const target = event.target;
          if (target instanceof HTMLInputElement && target.value.endsWith(raw)) {
            target.value = target.value.slice(0, -raw.length);
            target.dispatchEvent(new Event("input", { bubbles: true }));
          }
          dispatchNfcTag({ uid: readerUidToHex(raw), raw, source: "usb-reader", timestamp: Date.now() });
        }
        return;
      }
      if (/^[0-9a-fA-F]$/.test(event.key)) buffer += event.key;
      else if (event.key.length === 1 && !/[\s:-]/.test(event.key)) buffer = "";
    },
    true,
  );

  window.PusanNfc = {
    READER_FORMATS,
    dispatchManualUid,
    dispatchNfcTag,
    enableKeyboardReader,
    getReaderFormat,
    listenForNfc,
    normalizeUid,
    phoneNfcSupport,
    readerUidToHex,
    setReaderFormat,
    startNfcScan,
    stopNfcScan,
  };
})();
