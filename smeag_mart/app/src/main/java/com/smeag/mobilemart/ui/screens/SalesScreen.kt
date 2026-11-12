package com.smeag.mobilemart.ui.screens

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.smeag.mobilemart.AppViewModel
import com.smeag.mobilemart.NfcEvent
import java.math.RoundingMode
import com.smeag.mobilemart.data.SessionManager
import com.smeag.mobilemart.ui.components.*
import com.smeag.mobilemart.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun SalesScreen(
    viewModel: AppViewModel,
    nfcEvent: State<NfcEvent?>,
    onCheckoutComplete: () -> Unit,
) {
    var campus by remember { mutableStateOf(SessionManager.selectedCampus.value) }
    var awaitingTap by remember { mutableStateOf(false) }
    var lastHandledTs by remember { mutableStateOf(0L) }
    val context = LocalContext.current

    // "Find product by photo": take a picture, match it against registered product photos
    // on-device (see ProductPhotoMatcher/ImageEmbedder), and auto-add the closest match.
    val photoMatchCameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        if (bitmap != null) viewModel.matchProductPhoto(context, bitmap)
    }
    val photoMatchPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            safeLaunchSalesCamera(context) { photoMatchCameraLauncher.launch(null) }
        } else {
            Toast.makeText(context, "Camera permission is required to find a product by photo.", Toast.LENGTH_SHORT).show()
        }
    }
    fun startPhotoMatch() {
        val hasPermission = ContextCompat.checkSelfPermission(
            context, Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
        if (hasPermission) {
            safeLaunchSalesCamera(context) { photoMatchCameraLauncher.launch(null) }
        } else {
            photoMatchPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    // Category = store_menus.m_menu, Subcategory = store_menus.s_menu (product name).
    // Selecting "All" does not filter along that axis.
    val allLabel = "All"
    var selectedCategory by remember { mutableStateOf(allLabel) }
    var selectedSubcategory by remember { mutableStateOf(allLabel) }

    val categoryOptions = remember(viewModel.products.toList()) {
        listOf(allLabel) + viewModel.products.mapNotNull { it.mMenu }.distinct().sorted()
    }
    val subcategoryOptions = remember(viewModel.products.toList(), selectedCategory) {
        val base = if (selectedCategory == allLabel) viewModel.products
        else viewModel.products.filter { it.mMenu == selectedCategory }
        listOf(allLabel) + base.mapNotNull { it.sMenu }.distinct().sorted()
    }
    // Reset the subcategory selection, which may no longer be valid, when the category changes
    LaunchedEffect(selectedCategory) { selectedSubcategory = allLabel }

    val filteredProducts = remember(viewModel.products.toList(), selectedCategory, selectedSubcategory) {
        viewModel.products.filter { p ->
            (selectedCategory == allLabel || p.mMenu == selectedCategory) &&
                (selectedSubcategory == allLabel || p.sMenu == selectedSubcategory)
        }
    }

    val scrollState = rememberScrollState()
    val scrollScope = rememberCoroutineScope()

    LaunchedEffect(campus) { viewModel.loadProducts(campus, context) }

    LaunchedEffect(nfcEvent.value) {
        val event = nfcEvent.value ?: return@LaunchedEffect
        if (!awaitingTap || event.ts == lastHandledTs) return@LaunchedEffect
        lastHandledTs = event.ts
        awaitingTap = false
        viewModel.checkoutWithUid(event.uid, campus) { success ->
            if (success) onCheckoutComplete()
        }
    }

    // Automatically clear the NFC-waiting state once the cart is empty
    LaunchedEffect(viewModel.cart.isEmpty()) {
        if (viewModel.cart.isEmpty()) awaitingTap = false
    }

    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().background(BgColor).padding(18.dp)) {
        SectionEyebrow("Sales")
        ScreenTitle("Sales")
        CampusDropdown(selected = campus, options = SessionManager.campusOptions, onSelect = { campus = it })
        Row(Modifier.fillMaxWidth()) {
            Box(Modifier.weight(1f).padding(end = 4.dp)) {
                CampusDropdown(
                    selected = selectedCategory,
                    options = categoryOptions,
                    onSelect = { selectedCategory = it },
                    label = "Category",
                )
            }
            Box(Modifier.weight(1f).padding(start = 4.dp)) {
                CampusDropdown(
                    selected = selectedSubcategory,
                    options = subcategoryOptions,
                    onSelect = { selectedSubcategory = it },
                    label = "Subcategory",
                )
            }
        }

        Spacer(Modifier.height(8.dp))
        SecondaryButton(
            if (viewModel.isMatchingPhoto.value) "Analyzing photo..." else "📷 Find product by photo",
            modifier = Modifier.fillMaxWidth(),
            enabled = !viewModel.isMatchingPhoto.value,
        ) { startPhotoMatch() }
        viewModel.photoMatchMessage.value?.let {
            Text(it, fontSize = 11.5.sp, color = Ink2Color, modifier = Modifier.padding(top = 4.dp))
        }

        Column(Modifier.weight(1f).verticalScroll(scrollState)) {
            if (viewModel.isLoadingProducts.value) {
                CircularProgressIndicator(modifier = Modifier.padding(vertical = 12.dp))
            }

            if (filteredProducts.isEmpty() && !viewModel.isLoadingProducts.value) {
                Text("No products match the selected filters.", fontSize = 12.sp, color = Ink3Color, modifier = Modifier.padding(vertical = 12.dp))
            }

            ProductGrid(products = filteredProducts, onAdd = { viewModel.addToCart(it) })

            HorizontalDivider(Modifier.padding(vertical = 14.dp), color = BorderColor)
            SectionEyebrow("CART")
            Spacer(Modifier.height(8.dp))

            if (viewModel.cart.isEmpty()) {
                Text("Your cart is empty. Select a product above.", fontSize = 12.sp, color = Ink3Color)
            }
            viewModel.cart.forEach { item ->
                Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    ProductThumbnail(item.product.fullImageUrl, modifier = Modifier.size(40.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(item.product.sMenu ?: "-", fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Stepper(
                        quantity = item.quantity,
                        onMinus = { viewModel.changeQuantity(item.product, -1) },
                        onPlus = { viewModel.changeQuantity(item.product, 1) },
                    )
                }
            }

            Spacer(Modifier.height(4.dp))
            Row(Modifier.fillMaxWidth()) {
                DiscountChip("No Discount", viewModel.discountLabel.value == "No Discount") {
                    viewModel.discountLabel.value = "No Discount"; viewModel.discountRate.value = 0.0
                }
                Spacer(Modifier.width(8.dp))
                DiscountChip("Manager 15%", viewModel.discountLabel.value == "Manager 15%") {
                    viewModel.discountLabel.value = "Manager 15%"; viewModel.discountRate.value = 0.15
                }
                Spacer(Modifier.width(8.dp))
                DiscountChip("Teacher 10%", viewModel.discountLabel.value == "Teacher 10%") {
                    viewModel.discountLabel.value = "Teacher 10%"; viewModel.discountRate.value = 0.10
                }
            }

            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Total", fontSize = 12.sp, color = Ink2Color)
                Text("₱${viewModel.cartTotalAfterDiscount.setScale(2, java.math.RoundingMode.HALF_UP)}", fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }

            viewModel.checkoutError.value?.let {
                Text(it, color = OutColor, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(if (awaitingTap) OkBgColor else Surface2Color, RoundedCornerShape(14.dp))
                .clickable(enabled = viewModel.cart.isNotEmpty()) {
                    viewModel.checkoutError.value = null
                    awaitingTap = true
                }
                .padding(vertical = 16.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (awaitingTap) "📶" else "📶", fontSize = 24.sp)
                Text(
                    if (awaitingTap) "Please tap your NFC card..." else "Tap your NFC card on the back of the phone",
                    fontSize = 12.sp, fontWeight = FontWeight.Bold,
                )
                Text("Payment completes as soon as you tap", fontSize = 10.5.sp, color = Ink2Color)
            }
        }
    }

        // Scroll button that jumps straight to the cart/checkout area when the product list is long
        FloatingActionButton(
            onClick = { scrollScope.launch { scrollState.animateScrollTo(scrollState.maxValue) } },
            containerColor = BrandColor,
            contentColor = Color.White,
            shape = CircleShape,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 18.dp, bottom = 108.dp)
                .size(44.dp),
        ) { Text("⬇", fontSize = 18.sp) }
    }
}

@Composable
private fun ProductGrid(products: List<com.smeag.mobilemart.data.StoreMenu>, onAdd: (com.smeag.mobilemart.data.StoreMenu) -> Unit) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        modifier = Modifier.heightIn(max = 2000.dp).fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        userScrollEnabled = false,
    ) {
        items(products) { p ->
            Column(
                Modifier
                    .background(Surface2Color, RoundedCornerShape(12.dp))
                    .clickable { onAdd(p) }
                    .padding(8.dp),
            ) {
                ProductThumbnail(p.fullImageUrl, modifier = Modifier.fillMaxWidth().aspectRatio(1f))
                Spacer(Modifier.height(6.dp))
                Text(p.sMenu ?: "-", fontSize = 11.5.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                Text("₱${p.payment.setScale(2, RoundingMode.HALF_UP)}", fontSize = 11.sp, color = Ink2Color)
            }
        }
    }
}

@Composable
private fun Stepper(quantity: Int, onMinus: () -> Unit, onPlus: () -> Unit) {
    Row(
        modifier = Modifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepperButton("−", onMinus)
        Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) {
            Text(quantity.toString(), fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
        StepperButton("+", onPlus)
    }
}

@Composable
private fun StepperButton(symbol: String, onClick: () -> Unit) {
    Box(
        Modifier
            .size(24.dp)
            .background(Surface2Color, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(symbol, fontSize = 13.sp) }
}

@Composable
private fun RowScope.DiscountChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .weight(1f)
            .background(if (selected) BrandColor else Surface2Color, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 11.5.sp, fontWeight = FontWeight.Bold, color = if (selected) Color.White else Ink2Color)
    }
}

/**
 * Same purpose as RegisterScreen's private `safeLaunch`: catches the camera-app-missing /
 * permission-race exceptions that ActivityResultContracts.TakePicturePreview() can throw, so a
 * device with no camera app (or a denied-mid-launch permission) shows a toast instead of
 * crashing the whole app.
 */
private fun safeLaunchSalesCamera(context: Context, block: () -> Unit) {
    try {
        block()
    } catch (e: android.content.ActivityNotFoundException) {
        Toast.makeText(context, "No available camera app was found.", Toast.LENGTH_SHORT).show()
    } catch (e: SecurityException) {
        Toast.makeText(context, "Camera permission is required to do this.", Toast.LENGTH_SHORT).show()
    } catch (e: Exception) {
        Toast.makeText(context, "An error occurred while taking the photo.", Toast.LENGTH_SHORT).show()
    }
}

