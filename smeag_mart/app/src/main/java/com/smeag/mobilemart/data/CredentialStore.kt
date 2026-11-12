package com.smeag.mobilemart.data

import android.content.Context
import androidx.core.content.edit

/**
 * A very simple local store backing the "Remember me" checkbox on the login screen.
 * Saves the ID/password to the device's SharedPreferences so they're loaded automatically next time.
 *
 * Note: SharedPreferences is not stored encrypted. This is kept simple for now since it's a
 * local test/in-house app, but EncryptedSharedPreferences is recommended for a real deployment.
 */
object CredentialStore {
    private const val PREFS_NAME = "smeag_login_prefs"
    private const val KEY_REMEMBER = "remember_me"
    private const val KEY_LOGIN_ID = "saved_login_id"
    private const val KEY_PASSWORD = "saved_password"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    data class SavedCredential(val rememberMe: Boolean, val loginId: String, val password: String)

    fun load(context: Context): SavedCredential {
        val p = prefs(context)
        return SavedCredential(
            rememberMe = p.getBoolean(KEY_REMEMBER, false),
            loginId = p.getString(KEY_LOGIN_ID, "") ?: "",
            password = p.getString(KEY_PASSWORD, "") ?: "",
        )
    }

    fun save(context: Context, rememberMe: Boolean, loginId: String, password: String) {
        prefs(context).edit {
            putBoolean(KEY_REMEMBER, rememberMe)
            if (rememberMe) {
                putString(KEY_LOGIN_ID, loginId)
                putString(KEY_PASSWORD, password)
            } else {
                remove(KEY_LOGIN_ID)
                remove(KEY_PASSWORD)
            }
        }
    }
}
