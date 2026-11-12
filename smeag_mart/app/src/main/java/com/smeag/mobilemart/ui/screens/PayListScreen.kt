package com.smeag.mobilemart.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import com.smeag.mobilemart.data.PusanmartPaymentRecord
import com.smeag.mobilemart.ui.components.*
import com.smeag.mobilemart.ui.theme.*
import com.smeag.mobilemart.utils.ExcelUtil
import com.smeag.mobilemart.utils.PdfUtil
import kotlinx.coroutines.launch
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.SimpleDateFormat
import java.util.*

/**
 * "PayList": read-only search/history view over the `PusanmartPayments` table. Always scoped
 * to `center = 'PusanMart'` (there's only one center right now, so this isn't user-selectable —
 * see the PusanmartPayments schema). The date range is picked via the native date picker
 * ([DateSelectField]) rather than typed in, to avoid malformed date strings.
 *
 * "Download Excel" exports the currently-shown list as a .xlsx, with a summary block (searched
 * date range, transaction count, total amount earned) appended after the data rows.
 */
@Composable
fun PayListScreen(viewModel: AppViewModel) {
    val sdf = remember { SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()) }
    val today = remember { Date() }
    val weekAgo = remember { Date(today.time - 6L * 24 * 3600 * 1000) }
    var startDate by remember { mutableStateOf(sdf.format(weekAgo)) }
    var endDate by remember { mutableStateOf(sdf.format(today)) }
    var results by remember { mutableStateOf<List<PusanmartPaymentRecord>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val repo = remember { DbRepository() }
    val context = LocalContext.current

    fun runQuery() {
        scope.launch {
            loading = true
            error = null
            runCatching { repo.fetchPusanmartPayments(startDate, endDate) }
                .onSuccess { results = it }
                .onFailure { error = "조회에 실패했습니다: ${it.message}" }
            loading = false
        }
    }

    LaunchedEffect(Unit) { runQuery() }

    val total = remember(results) { results.fold(BigDecimal.ZERO) { acc, r -> acc.add(r.allPayments) } }

    fun downloadExcel() {
        val header = listOf(
            ExcelUtil.text("No"), ExcelUtil.text("Name"), ExcelUtil.text("NFCID"),
            ExcelUtil.text("Date"), ExcelUtil.text("Amount (PHP)"),
        )
        val dataRows = results.mapIndexed { idx, r ->
            listOf(
                ExcelUtil.number(BigDecimal(idx + 1)),
                ExcelUtil.text(r.name ?: "-"),
                ExcelUtil.text(r.nfcid),
                ExcelUtil.text(r.registerDays ?: "-"),
                ExcelUtil.number(r.allPayments.setScale(2, RoundingMode.HALF_UP)),
            )
        }
        val summaryRows = listOf(
            listOf(ExcelUtil.text("")),
            listOf(ExcelUtil.text("Search Range"), ExcelUtil.text("$startDate ~ $endDate")),
            listOf(ExcelUtil.text("Transaction Count"), ExcelUtil.number(BigDecimal(results.size))),
            listOf(ExcelUtil.text("Total Amount Earned (PHP)"), ExcelUtil.number(total.setScale(2, RoundingMode.HALF_UP))),
        )
        val file = ExcelUtil.writeSimpleSheet(
            context = context,
            fileNamePrefix = "pusanmart_paylist",
            sheetName = "PayList",
            rows = listOf(header) + dataRows + summaryRows,
        )
        val savedUri = PdfUtil.saveToDownloads(context, file, file.name, ExcelUtil.MIME_TYPE)
        if (savedUri != null) {
            Toast.makeText(context, "Downloads 폴더에 저장되었습니다: ${file.name}", Toast.LENGTH_LONG).show()
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
            downloadExcel()
        } else if (!granted) {
            Toast.makeText(context, "저장 권한이 없어 다운로드 폴더에 저장할 수 없습니다.", Toast.LENGTH_SHORT).show()
        }
        pendingDownload = false
    }

    fun requestExcelDownload() {
        val needsLegacyPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        if (needsLegacyPermission) {
            pendingDownload = true
            legacyStoragePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        } else {
            downloadExcel()
        }
    }

    Column(Modifier.fillMaxSize().background(BgColor).padding(18.dp)) {
        SectionEyebrow("PusanMart")
        ScreenTitle("Pay List")

        Row(Modifier.fillMaxWidth()) {
            Box(Modifier.weight(1f).padding(end = 4.dp)) {
                DateSelectField("Start Date", startDate) { startDate = it }
            }
            Box(Modifier.weight(1f).padding(start = 4.dp)) {
                DateSelectField("End Date", endDate) { endDate = it }
            }
        }
        SecondaryButton("Search") { runQuery() }
        Spacer(Modifier.height(10.dp))

        if (loading) CircularProgressIndicator(modifier = Modifier.padding(vertical = 12.dp))
        error?.let { Text(it, color = OutColor, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp)) }

        if (!loading && error == null) {
            Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${results.size}건", fontSize = 12.sp, color = Ink2Color)
                Text("합계 ₱${total.setScale(2, RoundingMode.HALF_UP)}", fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
            PrimaryButton("⬇ Download Excel", enabled = results.isNotEmpty()) { requestExcelDownload() }
            Spacer(Modifier.height(10.dp))
        }

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if (results.isEmpty() && !loading && error == null) {
                Text("해당 기간의 PusanMart 결제 내역이 없습니다.", fontSize = 12.sp, color = Ink3Color)
            }
            results.forEach { r ->
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 8.dp)
                        .background(Surface2Color, RoundedCornerShape(14.dp))
                        .padding(10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column {
                        Text(r.name ?: "-", fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                        Text("NFC ${r.nfcid}", fontSize = 10.5.sp, color = Ink2Color)
                        r.registerDays?.let {
                            Text(it, fontSize = 10.sp, color = Ink3Color)
                        }
                    }
                    Text("₱${r.allPayments.setScale(2, RoundingMode.HALF_UP)}", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
