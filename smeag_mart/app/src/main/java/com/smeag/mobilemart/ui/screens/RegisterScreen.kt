package com.smeag.mobilemart.ui.screens

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.smeag.mobilemart.AppViewModel
import com.smeag.mobilemart.data.SessionManager
import com.smeag.mobilemart.data.SftpUploader
import com.smeag.mobilemart.ui.components.*
import com.smeag.mobilemart.ui.theme.BgColor
import com.smeag.mobilemart.ui.theme.Ink3Color
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream
import java.math.BigDecimal

@Composable
fun RegisterScreen(viewModel: AppViewModel) {
    var campus by remember { mutableStateOf(SessionManager.selectedCampus.value) }
    var photoUri by remember { mutableStateOf<Uri?>(null) }
    var name by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("") }
    var minStock by remember { mutableStateOf("5") }
    var desc by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var uploading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // Save the bitmap captured by the camera to a cache file and convert it to a Uri
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        if (bitmap != null) {
            photoUri = saveBitmapToCache(context, bitmap)
        }
    }
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> photoUri = uri }

    // CAMERA permission is only declared in the manifest; if it's not requested at runtime, the
    // camera app can throw a SecurityException that crashes the app outright. We check/request
    // the permission when the button is pressed, and wrap the launch() call in try/catch so the
    // app doesn't crash even on devices with no camera/gallery app at all.
    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            safeLaunch(context) { cameraLauncher.launch(null) }
        } else {
            Toast.makeText(context, "Camera permission is required to take a photo.", Toast.LENGTH_SHORT).show()
        }
    }

    fun startCamera() {
        val hasPermission = ContextCompat.checkSelfPermission(
            context, Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
        if (hasPermission) {
            safeLaunch(context) { cameraLauncher.launch(null) }
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    fun startGallery() {
        safeLaunch(context) { pickImage.launch("image/*") }
    }

    Column(
        Modifier.fillMaxSize().background(BgColor).padding(18.dp).verticalScroll(rememberScrollState())
    ) {
        SectionEyebrow("Product Register")
        ScreenTitle("Register Product")

        CampusDropdown(selected = campus, options = SessionManager.campusOptions, onSelect = { campus = it })

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(120.dp)
                .border(1.dp, Ink3Color, RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (photoUri != null) {
                AsyncImage(
                    model = photoUri,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("📷", fontSize = 24.sp)
                    Spacer(Modifier.height(6.dp))
                    Text("Select a photo", fontSize = 11.5.sp, color = Ink3Color)
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 8.dp)) {
            SecondaryButton("📷 Take Photo", modifier = Modifier.weight(1f).padding(end = 4.dp)) {
                startCamera()
            }
            SecondaryButton("🖼 Choose from Gallery", modifier = Modifier.weight(1f).padding(start = 4.dp)) {
                startGallery()
            }
        }
        Spacer(Modifier.height(14.dp))

        LabeledField("Product Name", name, { name = it }, "e.g. Coke Zero 245ml")
        Row(Modifier.fillMaxWidth()) {
            Box(Modifier.weight(1f).padding(end = 4.dp)) {
                LabeledField("Product Price (PHP)", price, { price = it }, "0.00", KeyboardType.Decimal)
            }
            Box(Modifier.weight(1f).padding(start = 4.dp)) {
                LabeledField("Quantity", qty, { qty = it }, "0", KeyboardType.Number)
            }
        }
        LabeledField("Minimum Stock Threshold (Warn≤)", minStock, { minStock = it }, "e.g. 6", KeyboardType.Number)
        LabeledField("Description", desc, { desc = it }, "Optional")

        message?.let { Text(it, color = com.smeag.mobilemart.ui.theme.BrandColor, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp)) }

        PrimaryButton(if (uploading) "Uploading photo..." else "REGISTER", enabled = !uploading) {
            val priceVal = price.toBigDecimalOrNull()
            val qtyVal = qty.toIntOrNull()
            val minVal = minStock.toIntOrNull() ?: 5
            if (name.isBlank() || priceVal == null || qtyVal == null) {
                message = "Please enter a valid product name, price, and quantity."
                return@PrimaryButton
            }
            scope.launch {
                uploading = true
                // If insertProduct() fails it throws SQLException etc. as-is. Without try/catch in
                // this launch block, that exception would escape the coroutine and crash the whole
                // app. (This isn't limited to when a photo is attached — any exception during the
                // DB insert can crash the app if uncaught, e.g. the selected campus not matching the
                // DB's Campus enum, or an unstable network connection.)
                //
                // The photo upload is a separate try/catch on purpose: it hits a different server
                // (SFTP, not the DB) with its own failure modes (auth, permissions, network), and a
                // typo'd folder or a server hiccup there shouldn't stop the cashier from being able
                // to register the product itself. If it fails, we register with no photo and tell
                // the user so — they can still sell the item and add a photo later via Modify.
                var photoUploadError: String? = null
                val uploadedImagePath = photoUri?.let { uri ->
                    try {
                        SftpUploader.uploadProductPhoto(context, uri)
                    } catch (e: Exception) {
                        photoUploadError = e.message ?: "Unknown error"
                        null
                    }
                }
                val ok = try {
                    viewModel.repo.insertProduct(
                        campus = campus.uppercase(), mMenu = campus, sMenu = name,
                        imagePath = uploadedImagePath, price = priceVal, stock = qtyVal, minStock = minVal,
                    )
                } catch (e: Exception) {
                    message = "An error occurred during registration: ${e.message ?: "Unknown error"}"
                    null
                }
                uploading = false
                if (ok != null) {
                    message = when {
                        !ok -> "Registration failed."
                        photoUploadError != null -> "Registered successfully, but the photo could not be uploaded: $photoUploadError. You can add a photo later."
                        else -> "Registered successfully."
                    }
                    if (ok) { name = ""; price = ""; qty = ""; desc = ""; photoUri = null }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

private fun String.toBigDecimalOrNull(): BigDecimal? = try { if (isBlank()) null else BigDecimal(this) } catch (e: Exception) { null }

/**
 * Safely wraps the launch() call for the camera/gallery activity.
 * Catches exceptions such as camera permission issues (SecurityException)
 * or devices without a camera/gallery app (ActivityNotFoundException) so
 * the app doesn't crash — the user just sees a message instead.
 */
private fun safeLaunch(context: Context, block: () -> Unit) {
    try {
        block()
    } catch (e: android.content.ActivityNotFoundException) {
        Toast.makeText(context, "No available camera or gallery app was found.", Toast.LENGTH_SHORT).show()
    } catch (e: SecurityException) {
        Toast.makeText(context, "Camera permission is required to do this.", Toast.LENGTH_SHORT).show()
    } catch (e: Exception) {
        Toast.makeText(context, "An error occurred while loading the photo.", Toast.LENGTH_SHORT).show()
    }
}

/** Saves a Bitmap taken by the camera to a file in the app cache folder and returns its Uri. */
private fun saveBitmapToCache(context: Context, bitmap: Bitmap): Uri {
    val dir = File(context.cacheDir, "photos").also { it.mkdirs() }
    val file = File(dir, "photo_${System.currentTimeMillis()}.jpg")
    FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
    return Uri.fromFile(file)
}
