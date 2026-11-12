package com.smeag.mobilemart.nfc

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.content.IntentFilter
import android.nfc.NfcAdapter
import android.nfc.Tag

/**
 * Wraps the phone's built-in NFC reader (foreground dispatch) so that
 * tagging a student/manager card to the back of the phone delivers the
 * card UID to [onTagRead] from anywhere in the app (Sales checkout,
 * Buyer Info lookup).
 *
 * NOTE: the reference C# desktop system uses a USB ACR122U reader.
 * Android phones instead use their own built-in NFC antenna, so cards
 * must be NFC-compatible (ISO14443) for the phone to read their UID -
 * this mirrors the same `uid` value stored in the `person`/`bank`
 * tables, so no schema change is required.
 */
class NfcHelper(private val activity: Activity) {

    private var adapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(activity)
    var onTagRead: ((String) -> Unit)? = null

    val isNfcAvailable: Boolean get() = adapter != null
    val isNfcEnabled: Boolean get() = adapter?.isEnabled == true

    fun enableForegroundDispatch() {
        val a = adapter ?: return
        val intent = Intent(activity, activity.javaClass).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            activity, 0, intent,
            PendingIntent.FLAG_MUTABLE
        )
        val filters = arrayOf(IntentFilter(NfcAdapter.ACTION_TAG_DISCOVERED))
        a.enableForegroundDispatch(activity, pendingIntent, filters, null)
    }

    fun disableForegroundDispatch() {
        adapter?.disableForegroundDispatch(activity)
    }

    /** Call from Activity.onNewIntent(). Returns the tag UID (hex string) if this was an NFC intent. */
    fun handleIntent(intent: Intent): String? {
        if (intent.action != NfcAdapter.ACTION_TAG_DISCOVERED &&
            intent.action != NfcAdapter.ACTION_TECH_DISCOVERED &&
            intent.action != NfcAdapter.ACTION_NDEF_DISCOVERED
        ) return null

        @Suppress("DEPRECATION")
        val tag: Tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG) ?: return null
        val uid = tag.id.joinToString("") { String.format("%02x", it) }
        onTagRead?.invoke(uid)
        return uid
    }
}
