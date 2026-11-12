package com.smeag.mobilemart.data

import androidx.compose.runtime.mutableStateOf

/** Simple in-memory session for the logged-in manager + currently selected campus. */
object SessionManager {
    val currentManager = mutableStateOf<MgPerson?>(null)
    val selectedCampus = mutableStateOf("Capital")

    val campusOptions = listOf("Capital", "Encanto", "Tarlac", "Baydream", "Restobar", "Pusan Mart")

    fun logout() {
        currentManager.value = null
    }
}
