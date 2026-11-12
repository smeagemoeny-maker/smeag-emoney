package com.smeag.mobilemart.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smeag.mobilemart.AppViewModel
import com.smeag.mobilemart.data.BankTransaction
import com.smeag.mobilemart.data.DbRepository
import com.smeag.mobilemart.data.SessionManager
import com.smeag.mobilemart.ui.components.*
import com.smeag.mobilemart.ui.theme.*
import kotlinx.coroutines.launch
import java.math.RoundingMode
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun HistoryScreen(viewModel: AppViewModel) {
    val allLabel = "All"
    var campus by remember { mutableStateOf("All Campuses") }
    val sdf = remember { SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()) }
    var startDate by remember { mutableStateOf(sdf.format(Date(System.currentTimeMillis() - 16L * 24L * 3600L * 1000L))) }
    var endDate by remember { mutableStateOf(sdf.format(Date())) }
    // Unfiltered results for the selected campus/date range; category/subcategory options are
    // derived from this list, and the displayed list below is filtered from it client-side.
    var allResults by remember { mutableStateOf<List<BankTransaction>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val repo = remember { DbRepository() }

    var selectedCategory by remember { mutableStateOf(allLabel) }
    var selectedSubcategory by remember { mutableStateOf(allLabel) }

    fun runQuery() {
        scope.launch {
            loading = true
            allResults = runCatching { repo.fetchHistory(campus, startDate, endDate) }.getOrDefault(emptyList())
            loading = false
        }
    }

    LaunchedEffect(Unit) { runQuery() }

    val categoryOptions = remember(allResults) {
        listOf(allLabel) + allResults.mapNotNull { it.category?.takeIf { c -> c.isNotBlank() } }.distinct().sorted()
    }
    val subcategoryOptions = remember(allResults, selectedCategory) {
        val base = if (selectedCategory == allLabel) allResults else allResults.filter { it.category == selectedCategory }
        listOf(allLabel) + base.mapNotNull { it.subcategory?.takeIf { s -> s.isNotBlank() } }.distinct().sorted()
    }
    // Reset the category/subcategory selections whenever they no longer exist among the options
    // (e.g. after changing campus or date range).
    LaunchedEffect(categoryOptions) {
        if (selectedCategory !in categoryOptions) selectedCategory = allLabel
    }
    LaunchedEffect(subcategoryOptions) {
        if (selectedSubcategory !in subcategoryOptions) selectedSubcategory = allLabel
    }

    val results = remember(allResults, selectedCategory, selectedSubcategory) {
        allResults.filter { tx ->
            (selectedCategory == allLabel || tx.category == selectedCategory) &&
                (selectedSubcategory == allLabel || tx.subcategory == selectedSubcategory)
        }
    }

    Column(Modifier.fillMaxSize().background(BgColor).padding(18.dp)) {
        SectionEyebrow("Sales History")
        ScreenTitle("Sales History")
        CampusDropdown(
            selected = campus,
            options = listOf("All Campuses") + SessionManager.campusOptions,
            onSelect = { campus = it; runQuery() },
            label = "Campus",
        )
        Row(Modifier.fillMaxWidth()) {
            Box(Modifier.weight(1f).padding(end = 4.dp)) {
                DateSelectField("Start Date", startDate) { startDate = it }
            }
            Box(Modifier.weight(1f).padding(start = 4.dp)) {
                DateSelectField("End Date", endDate) { endDate = it }
            }
        }
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
        SecondaryButton("Search") { runQuery() }
        Spacer(Modifier.height(10.dp))

        if (loading) CircularProgressIndicator(modifier = Modifier.padding(vertical = 12.dp))

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if (results.isEmpty() && !loading) {
                Text("No sales history found.", fontSize = 12.sp, color = Ink3Color)
            }
            results.forEach { tx ->
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 8.dp)
                        .background(Surface2Color, androidx.compose.foundation.shape.RoundedCornerShape(14.dp))
                        .padding(10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column {
                        Text("${tx.subcategory ?: "-"}${if (tx.quantity > 1) " × ${tx.quantity}" else ""}", fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                        Text("Buyer: ${tx.name ?: "-"}", fontSize = 10.5.sp, color = Ink2Color)
                        Text("${tx.campus ?: "-"} · ${tx.remark ?: tx.transactionSource}", fontSize = 10.5.sp, color = Ink2Color)
                        tx.transactionDate?.let {
                            Text(it, fontSize = 10.sp, color = Ink3Color)
                        }
                    }
                    Text("₱${tx.payment.setScale(2, RoundingMode.HALF_UP)}", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
