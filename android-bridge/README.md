# Android NFC Bridge

This folder contains the native bridge contract for wrapping the PWA in an Android WebView or Capacitor-style shell.

## Purpose

The production PWA should receive card UIDs from Android native NFC, not depend only on Web NFC.

Native Android must read the UID with the same normalization as the existing Android app:

```kotlin
val uid = tag.id.joinToString("") { "%02x".format(it) }
```

Then it should dispatch this JavaScript event into the PWA:

```js
window.dispatchEvent(new CustomEvent("nfc-tag", {
  detail: {
    uid: "04abcd1234",
    source: "android-native",
    timestamp: Date.now()
  }
}));
```

## Required Android manifest entries

```xml
<uses-permission android:name="android.permission.NFC" />
<uses-feature android:name="android.hardware.nfc" android:required="false" />
```

## Implementation note

Use the existing Android app as the UID parity oracle before switching production checkout to the PWA wrapper.
