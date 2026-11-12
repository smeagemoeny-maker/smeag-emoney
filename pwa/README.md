# PUSAN MART PWA

This is the first rebuild slice for the PUSAN MART POS PWA.

## What is included

- Installable PWA shell with `manifest.webmanifest` and service worker.
- Sales, Buyer Lookup, PusanMart Payment, and Settings screens.
- API client wired to the new `api/` service.
- NFC service contract for Android native bridge, Web NFC fallback, and manual UID testing.

## NFC bridge event

The Android wrapper should dispatch this event into the WebView:

```js
window.dispatchEvent(new CustomEvent("nfc-tag", {
  detail: {
    uid: "04abcd1234",
    source: "android-native",
    timestamp: Date.now()
  }
}));
```

The UID must match the old Android app format:

```kotlin
val uid = tag.id.joinToString("") { "%02x".format(it) }
```

## Local run

```bash
npm install
npm run dev
```

The default API URL is `http://localhost:8787`. Change it in the Settings screen if needed.
