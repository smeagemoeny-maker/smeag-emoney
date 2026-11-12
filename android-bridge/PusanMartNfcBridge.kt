package com.smeag.pusanmart.bridge

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView

/**
 * Phone NFC for the PWA inside a WebView.
 *
 * Usage in the hosting Activity:
 *   bridge = PusanMartNfcBridge(this, webView)
 *   bridge.attach()          // after webView.settings.javaScriptEnabled = true, before loadUrl
 *   override fun onPause() { super.onPause(); bridge.stopScan() }
 *
 * The PWA calls window.PusanMartNfc.startScan() when it expects a card and
 * receives the UID as a window 'nfc-tag' event.
 */
class PusanMartNfcBridge(
    private val activity: Activity,
    private val webView: WebView,
) : NfcAdapter.ReaderCallback {

    private val adapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(activity)

    val isAvailable: Boolean get() = adapter != null
    val isEnabled: Boolean get() = adapter?.isEnabled == true

    fun attach() {
        webView.addJavascriptInterface(JsApi(), "PusanMartNfc")
    }

    fun startScan() {
        val flags = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or
            NfcAdapter.FLAG_READER_NFC_V or
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
        activity.runOnUiThread {
            if (adapter?.isEnabled == false) {
                dispatch("nfc-error", "{ message: '폰의 NFC가 꺼져 있습니다. 설정에서 NFC를 켜세요.' }")
            }
            adapter?.enableReaderMode(activity, this, flags, Bundle())
        }
    }

    fun stopScan() {
        activity.runOnUiThread { adapter?.disableReaderMode(activity) }
    }

    override fun onTagDiscovered(tag: Tag) {
        // Same format as the old Android app and person.uid: lowercase hex, no separators.
        val uid = tag.id.joinToString("") { "%02x".format(it) }
        dispatch("nfc-tag", "{ uid: '$uid', source: 'android-native', timestamp: Date.now() }")
    }

    private fun dispatch(event: String, detail: String) {
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('$event', { detail: $detail }));",
                null,
            )
        }
    }

    private inner class JsApi {
        @JavascriptInterface fun startScan() = this@PusanMartNfcBridge.startScan()
        @JavascriptInterface fun stopScan() = this@PusanMartNfcBridge.stopScan()
        @JavascriptInterface fun isAvailable(): Boolean = this@PusanMartNfcBridge.isAvailable
        @JavascriptInterface fun isEnabled(): Boolean = this@PusanMartNfcBridge.isEnabled
    }
}
