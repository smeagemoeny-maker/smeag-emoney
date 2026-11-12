package com.smeag.mobilemart.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smeag.mobilemart.AppViewModel
import com.smeag.mobilemart.data.SessionManager
import com.smeag.mobilemart.data.StoreMenu
import com.smeag.mobilemart.ui.components.*
import com.smeag.mobilemart.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun ModifyScreen(viewModel: AppViewModel) {
    var campus by remember { mutableStateOf(SessionManager.selectedCampus.value) }
    var category by remember { mutableStateOf("All") }
    var subcategory by remember { mutableStateOf("All") }
    var selected by remember { mutableStateOf<StoreMenu?>(null) }
    var stockInput by remember { mutableStateOf("") }
    var minStockInput by remember { mutableStateOf("") }
    var priceInput by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var productPendingDelete by remember { mutableStateOf<StoreMenu?>(null) }
    var isDeleting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(campus) { viewModel.loadProducts(campus) }

    // Only offer categories (m_menu) that actually exist among the products loaded for this campus
    val categoryOptions = remember(viewModel.products.toList()) {
        listOf("All") + viewModel.products.mapNotNull { it.mMenu?.takeIf { m -> m.isNotBlank() } }.distinct().sorted()
    }
    // Recompute the subcategory (product name) list within the selected category whenever it changes
    val subcategoryOptions = remember(viewModel.products.toList(), category) {
        val base = if (category == "All") viewModel.products else viewModel.products.filter { it.mMenu == category }
        listOf("All") + base.mapNotNull { it.sMenu?.takeIf { s -> s.isNotBlank() } }.distinct().sorted()
    }
    // Reset the selection if it's no longer among the options (e.g. after a campus change)
    LaunchedEffect(categoryOptions) {
        if (category !in categoryOptions) category = "All"
    }
    LaunchedEffect(subcategoryOptions) {
        if (subcategory !in subcategoryOptions) subcategory = "All"
    }

    val filteredProducts = viewModel.products.filter { p ->
        (category == "All" || p.mMenu == category) && (subcategory == "All" || p.sMenu == subcategory)
    }

    fun selectProduct(product: StoreMenu) {
        selected = product
        stockInput = product.stock.toString()
        minStockInput = product.minStock.toString()
        priceInput = product.payment.toPlainString()
        message = null
    }

    Column(Modifier.fillMaxSize().background(BgColor).padding(18.dp).verticalScroll(rememberScrollState())) {
        SectionEyebrow("Product Modify")
        ScreenTitle("Edit Products")
        CampusDropdown(selected = campus, options = SessionManager.campusOptions, onSelect = { campus = it })
        CampusDropdown(
            selected = category,
            options = categoryOptions,
            onSelect = { category = it; subcategory = "All" },
            label = "Category",
        )
        CampusDropdown(
            selected = subcategory,
            options = subcategoryOptions,
            onSelect = { subcategory = it },
            label = "Subcategory",
        )

        if (viewModel.isLoadingProducts.value) {
            CircularProgressIndicator(modifier = Modifier.padding(vertical = 12.dp))
        }

        if (!viewModel.isLoadingProducts.value && filteredProducts.isEmpty()) {
            Text("No products match the selected filters.", fontSize = 12.5.sp, color = Ink2Color, modifier = Modifier.padding(vertical = 8.dp))
        }

        filteredProducts.forEach { product ->
            val isSelected = selected?.id == product.id
            val borderColor = when (product.stockStatus) {
                com.smeag.mobilemart.data.StockStatus.OK -> BorderColor
                com.smeag.mobilemart.data.StockStatus.LOW -> LowColor
                com.smeag.mobilemart.data.StockStatus.OUT -> OutColor
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp)
                    .background(if (isSelected) BrandColor.copy(alpha = 0.08f) else Surface2Color, RoundedCornerShape(14.dp))
                    .border(if (isSelected) 2.dp else 1.dp, if (isSelected) BrandColor else borderColor, RoundedCornerShape(14.dp))
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable {
                            if (isSelected) selected = null else selectProduct(product)
                        }
                        .padding(10.dp),
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    ProductThumbnail(product.fullImageUrl, modifier = Modifier.size(40.dp))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(product.sMenu ?: "-", fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                        Text("Stock ${product.stock} · Threshold ${product.minStock}", fontSize = 10.5.sp, color = Ink2Color)
                    }
                    StockBadge(product.stockStatus)
                }

                // Edit fields appear directly below the selected item
                if (isSelected) {
                    HorizontalDivider(color = borderColor)
                    Column(Modifier.padding(10.dp)) {
                        Row(Modifier.fillMaxWidth()) {
                            Box(Modifier.weight(1f).padding(end = 4.dp)) {
                                LabeledField("Stock Quantity", stockInput, { stockInput = it }, keyboardType = KeyboardType.Number)
                            }
                            Box(Modifier.weight(1f).padding(start = 4.dp)) {
                                LabeledField("Minimum Stock Threshold", minStockInput, { minStockInput = it }, keyboardType = KeyboardType.Number)
                            }
                        }
                        LabeledField("Price (PHP)", priceInput, { priceInput = it }, keyboardType = KeyboardType.Decimal)

                        message?.let { Text(it, color = BrandColor, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp)) }

                        PrimaryButton("Save Changes") {
                            val newStock = stockInput.toIntOrNull()
                            val newMin = minStockInput.toIntOrNull()
                            val newPrice = priceInput.toBigDecimalOrNull()
                            if (newStock == null || newMin == null) {
                                message = "Please enter a valid stock quantity."
                                return@PrimaryButton
                            }
                            scope.launch {
                                val ok = try {
                                    viewModel.repo.updateProductStock(product.id, newStock, newMin, newPrice)
                                } catch (e: Exception) {
                                    message = "An error occurred while saving: ${e.message ?: "Unknown error"}"
                                    null
                                }
                                if (ok != null) {
                                    message = if (ok) "Changes saved." else "Failed to save changes."
                                    if (ok) viewModel.loadProducts(campus)
                                }
                            }
                        }

                        Spacer(Modifier.height(8.dp))

                        TextButton(
                            onClick = { productPendingDelete = product },
                            enabled = !isDeleting,
                            colors = ButtonDefaults.textButtonColors(contentColor = OutColor),
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Delete Product", fontWeight = FontWeight.Bold, fontSize = 13.sp) }
                    }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }

    productPendingDelete?.let { toDelete ->
        AlertDialog(
            onDismissRequest = { if (!isDeleting) productPendingDelete = null },
            title = { Text("Delete Product") },
            text = { Text("Delete \"${toDelete.sMenu ?: "this product"}\"? This cannot be undone.") },
            confirmButton = {
                TextButton(
                    enabled = !isDeleting,
                    onClick = {
                        isDeleting = true
                        scope.launch {
                            val ok = try {
                                viewModel.repo.deleteProduct(toDelete.id)
                            } catch (e: Exception) {
                                message = "An error occurred while deleting: ${e.message ?: "Unknown error"}"
                                null
                            }
                            isDeleting = false
                            productPendingDelete = null
                            if (ok != null) {
                                if (ok) {
                                    if (selected?.id == toDelete.id) selected = null
                                    message = "Product deleted."
                                    viewModel.loadProducts(campus)
                                } else {
                                    message = "Failed to delete product."
                                }
                            }
                        }
                    },
                ) { Text(if (isDeleting) "Deleting..." else "Delete", color = OutColor, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(enabled = !isDeleting, onClick = { productPendingDelete = null }) { Text("Cancel") }
            },
        )
    }
}

private fun String.toBigDecimalOrNull(): java.math.BigDecimal? =
    try { if (isBlank()) null else java.math.BigDecimal(this) } catch (e: Exception) { null }
