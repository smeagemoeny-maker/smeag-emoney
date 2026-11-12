package com.smeag.mobilemart.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.smeag.mobilemart.AppViewModel
import com.smeag.mobilemart.data.DbRepository
import com.smeag.mobilemart.data.SessionManager
import com.smeag.mobilemart.ui.components.*
import com.smeag.mobilemart.ui.theme.*
import com.smeag.mobilemart.utils.PdfUtil
import kotlinx.coroutines.launch
import java.math.RoundingMode
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun ReportScreen(viewModel: AppViewModel) {
    var campus by remember { mutableStateOf("All Campuses") }
    val sdf = remember { SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()) }
    val today = remember { Date() }
    val weekAgo = remember { Date(today.time - 6L * 24 * 3600 * 1000) }
    var startDate by remember { mutableStateOf(sdf.format(weekAgo)) }
    var endDate by remember { mutableStateOf(sdf.format(today)) }
    var report by remember { mutableStateOf<DbRepository.WeeklyReport?>(null) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    fun load() {
        scope.launch {
            loading = true
            report = runCatching { viewModel.repo.fetchWeeklyReport(campus, startDate, endDate) }.getOrNull()
            loading = false
        }
    }
    LaunchedEffect(Unit) { load() }

    fun downloadReportPdf(r: DbRepository.WeeklyReport) {
        val pdfFile = PdfUtil.generateReportPdf(context, campus, startDate, endDate, r)
        val savedUri = PdfUtil.saveToDownloads(context, pdfFile, pdfFile.name, "application/pdf")
        if (savedUri != null) {
            Toast.makeText(context, "Downloads 폴더에 저장되었습니다: ${pdfFile.name}", Toast.LENGTH_LONG).show()
        } else {
            Toast.makeText(context, "저장에 실패했습니다. 저장 권한을 확인해 주세요.", Toast.LENGTH_LONG).show()
        }
    }

    // Pre-Android-10 devices need WRITE_EXTERNAL_STORAGE to save into the public Downloads
    // folder (see PdfUtil.saveToDownloads). Android 10+ doesn't need this at all.
    var pendingDownload by remember { mutableStateOf(false) }
    val legacyStoragePermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted && pendingDownload) {
            report?.let { downloadReportPdf(it) }
        } else if (!granted) {
            Toast.makeText(context, "저장 권한이 없어 다운로드 폴더에 저장할 수 없습니다.", Toast.LENGTH_SHORT).show()
        }
        pendingDownload = false
    }

    fun requestReportDownload() {
        val r = report ?: return
        val needsLegacyPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        if (needsLegacyPermission) {
            pendingDownload = true
            legacyStoragePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        } else {
            downloadReportPdf(r)
        }
    }

    Column(Modifier.fillMaxSize().background(BgColor).padding(18.dp).verticalScroll(rememberScrollState())) {
        SectionEyebrow("Report")
        ScreenTitle("Report")
        CampusDropdown(
            selected = campus,
            options = listOf("All Campuses") + SessionManager.campusOptions,
            onSelect = { campus = it; load() },
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
        SecondaryButton("Search") { load() }
        Spacer(Modifier.height(10.dp))

        if (loading) CircularProgressIndicator(modifier = Modifier.padding(vertical = 12.dp))

        report?.let { r ->
            PrimaryButton("⬇ Download Report PDF") { requestReportDownload() }
            Spacer(Modifier.height(14.dp))
            Row(Modifier.fillMaxWidth()) {
                StatCard("Total Revenue", "₱${r.totalRevenue.setScale(0, RoundingMode.HALF_UP)}", Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                StatCard("Transactions", "${r.transactionCount}", Modifier.weight(1f))
            }
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth()) {
                StatCard("Avg. Order Value", "₱${r.avgOrderValue}", Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                StatCard("Low Stock Alerts", "${r.lowStock.size}", Modifier.weight(1f), valueColor = LowColor)
            }

            Spacer(Modifier.height(16.dp))
            SectionEyebrow("Daily Sales")
            Spacer(Modifier.height(8.dp))
            val maxVal = (r.dailyTotals.maxOfOrNull { it.second.toDouble() } ?: 1.0).coerceAtLeast(1.0)
            Row(Modifier.fillMaxWidth().height(90.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                r.dailyTotals.forEach { (date, amount) ->
                    val heightFrac = (amount.toDouble() / maxVal).coerceIn(0.04, 1.0)
                    Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = androidx.compose.ui.Alignment.BottomCenter) {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .fillMaxHeight((heightFrac).toFloat())
                                .background(BrandColor, RoundedCornerShape(topStart = 5.dp, topEnd = 5.dp)),
                        )
                    }
                }
            }
            Row(Modifier.fillMaxWidth()) {
                r.dailyTotals.forEach { (date, _) ->
                    Text(date.takeLast(2), fontSize = 9.5.sp, color = Ink3Color, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                }
            }

            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = BorderColor)
            Spacer(Modifier.height(12.dp))
            SectionEyebrow("Top Sellers (by Quantity)")
            Spacer(Modifier.height(8.dp))
            r.topProducts.forEachIndexed { idx, (name, qty) ->
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 6.dp)
                        .background(Surface2Color, RoundedCornerShape(14.dp)).padding(10.dp),
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(20.dp).background(if (idx == 0) BrandColor else InkColor, RoundedCornerShape(50)),
                        contentAlignment = androidx.compose.ui.Alignment.Center,
                    ) { Text("${idx + 1}", color = androidx.compose.ui.graphics.Color.White, fontSize = 10.5.sp, fontWeight = FontWeight.Bold) }
                    Spacer(Modifier.width(8.dp))
                    Text(name, fontSize = 12.sp, modifier = Modifier.weight(1f))
                    Text("${qty}", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }

            Spacer(Modifier.height(12.dp))
            HorizontalDivider(color = BorderColor)
            Spacer(Modifier.height(12.dp))
            SectionEyebrow("Low Stock Items")
            Spacer(Modifier.height(8.dp))
            r.lowStock.forEach { p ->
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 6.dp)
                        .background(Surface2Color, RoundedCornerShape(14.dp)).padding(10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(p.sMenu ?: "-", fontSize = 12.sp)
                    StockBadge(p.stockStatus)
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier, valueColor: androidx.compose.ui.graphics.Color = InkColor) {
    Column(
        modifier
            .background(Surface2Color, RoundedCornerShape(12.dp))
            .border(1.dp, BorderColor, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Text(label.uppercase(), fontSize = 9.5.sp, fontWeight = FontWeight.Bold, color = Ink3Color)
        Spacer(Modifier.height(3.dp))
        Text(value, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, color = valueColor)
    }
}
