package com.smeag.mobilemart.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smeag.mobilemart.data.CredentialStore
import com.smeag.mobilemart.data.DbRepository
import com.smeag.mobilemart.data.SessionManager
import com.smeag.mobilemart.ui.components.CampusDropdown
import com.smeag.mobilemart.ui.components.LabeledField
import com.smeag.mobilemart.ui.components.PrimaryButton
import com.smeag.mobilemart.ui.theme.BgColor
import com.smeag.mobilemart.ui.theme.BrandColor
import com.smeag.mobilemart.ui.theme.Ink2Color
import com.smeag.mobilemart.ui.theme.Ink3Color
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(onLoginSuccess: () -> Unit) {
    val context = LocalContext.current
    var campus by remember { mutableStateOf(SessionManager.campusOptions.first()) }
    var loginId by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var rememberMe by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val repo = remember { DbRepository() }

    // If saved credentials exist, load them automatically when the screen appears.
    LaunchedEffect(Unit) {
        val saved = CredentialStore.load(context)
        rememberMe = saved.rememberMe
        if (saved.rememberMe) {
            loginId = saved.loginId
            password = saved.password
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(BgColor)
            .imePadding() // Add padding when the keyboard appears so it doesn't cover the input fields
            .verticalScroll(rememberScrollState()) // Allow scrolling to reach content below even on smaller screens
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier.size(60.dp).background(BrandColor, RoundedCornerShape(16.dp)),
                contentAlignment = Alignment.Center,
            ) { Text("S", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold) }

            Spacer(Modifier.height(16.dp))
            Text("SMEAG Mobile Mart", fontSize = 19.sp, fontWeight = FontWeight.ExtraBold)
            Text("Admin (Manager) Login Only", fontSize = 12.5.sp, color = Ink2Color, modifier = Modifier.padding(top = 2.dp))

            Spacer(Modifier.height(22.dp))
            CampusDropdown(selected = campus, options = SessionManager.campusOptions, onSelect = { campus = it })
            LabeledField(label = "ID", value = loginId, onChange = { loginId = it }, placeholder = "Manager account (staff ID / email)")
            OutlinedTextFieldPassword(password) { password = it }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
            ) {
                Checkbox(checked = rememberMe, onCheckedChange = { rememberMe = it })
                Text(
                    "Remember me",
                    fontSize = 12.5.sp,
                    color = Ink2Color,
                    modifier = Modifier.padding(start = 2.dp),
                )
            }

            error?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            }

            Spacer(Modifier.height(8.dp))
            PrimaryButton(text = if (loading) "Logging in..." else "Login", enabled = !loading) {
                error = null
                loading = true
                scope.launch {
                    val result = try {
                        repo.login(loginId.trim(), password.trim())
                    } catch (e: Exception) {
                        loading = false
                        error = "Unable to connect to the server: ${e.message ?: "Unknown error"}"
                        return@launch
                    }
                    loading = false
                    if (result != null) {
                        CredentialStore.save(context, rememberMe, loginId.trim(), password.trim())
                        SessionManager.currentManager.value = result
                        SessionManager.selectedCampus.value = campus
                        onLoginSuccess()
                    } else {
                        error = "Incorrect ID or password."
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Text(
                "※ Students / buyers can look up their info by tapping an\nNFC card only, without logging in",
                fontSize = 10.5.sp, color = Ink3Color, textAlign = TextAlign.Center, lineHeight = 15.sp,
            )
        }
    }
}

@Composable
private fun OutlinedTextFieldPassword(value: String, onChange: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(bottom = 11.dp)) {
        Text("Password", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = Ink2Color,
            modifier = Modifier.padding(bottom = 5.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text("••••••••") },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
