package com.smeag.mobilemart.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.smeag.mobilemart.AppViewModel
import com.smeag.mobilemart.data.SessionManager
import com.smeag.mobilemart.ui.components.PrimaryButton
import com.smeag.mobilemart.ui.components.SecondaryButton
import com.smeag.mobilemart.ui.components.SmeagCard
import com.smeag.mobilemart.ui.theme.*
import com.smeag.mobilemart.utils.PdfUtil
import com.smeag.mobilemart.utils.ReceiptRenderer
import java.math.RoundingMode

/**
 * Shown right after a successful NFC checkout (see SalesScreen -> AppViewModel.checkoutWithUid).
 * Matches the "Payment Complete" screen in the approved mockup: line items, discount, final total,
 * remaining NFC balance, PDF download and KakaoTalk share.
 */
@Composable
fun ReceiptScreen(viewModel: AppViewModel, onDone: () -> Unit) {
    val context = LocalContext.current

    val receiptData = remember(
        viewModel.lastCart.toList(), viewModel.lastFinalTotal.value, viewModel.lastRemainingBalance.value,
    ) {
        ReceiptRenderer.fromCart(
            campus = SessionManager.selectedCampus.value,
            buyerUid = viewModel.lastBuyerUid.value,
            cart = viewModel.lastCart.toList(),
            finalTotal = viewModel.lastFinalTotal.value,
            remainingBalance = viewModel.lastRemainingBalance.value,
            approvalNumber = viewModel.lastApprovalNumber.value,
            transactionTimeMillis = viewModel.lastTransactionTimeMillis.value,
        )
    }

    // Pre-Android-10 devices need WRITE_EXTERNAL_STORAGE to save into the public Downloads
    // folder (see PdfUtil.saveToDownloads). Android 10+ doesn't need this at all.
    var pendingDownload by remember { mutableStateOf(false) }
    val legacyStoragePermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted && pendingDownload) {
            downloadReceiptPdf(context, receiptData)
        } else if (!granted) {
            Toast.makeText(context, "저장 권한이 없어 다운로드 폴더에 저장할 수 없습니다.", Toast.LENGTH_SHORT).show()
        }
        pendingDownload = false
    }

    fun requestDownload() {
        val needsLegacyPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        if (needsLegacyPermission) {
            pendingDownload = true
            legacyStoragePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        } else {
            downloadReceiptPdf(context, receiptData)
        }
    }

    Column(
        Modifier.fillMaxSize().background(BgColor).padding(18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier.size(56.dp).background(OkBgColor, RoundedCornerShape(50)),
            contentAlignment = Alignment.Center,
        ) { Text("✓", color = OkColor, fontSize = 26.sp) }

        Spacer(Modifier.height(12.dp))
        Text("Payment Complete", fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
        Text(SessionManager.selectedCampus.value, fontSize = 11.5.sp, color = Ink2Color, modifier = Modifier.padding(top = 2.dp, bottom = 14.dp))

        SmeagCard {
            viewModel.lastCart.forEach { item ->
                Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("${item.product.sMenu} × ${item.quantity}", fontSize = 12.sp, color = Ink2Color)
                    Text("₱${item.lineTotal.setScale(2, RoundingMode.HALF_UP)}", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
            val subtotal = viewModel.lastCart.fold(java.math.BigDecimal.ZERO) { acc, i -> acc + i.lineTotal }
            val discount = subtotal.multiply(java.math.BigDecimal(viewModel.lastDiscountRate.value))
            Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(viewModel.lastDiscountLabel.value, fontSize = 12.sp, color = Ink2Color)
                Text("−₱${discount.setScale(2, RoundingMode.HALF_UP)}", fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = BorderColor)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Final Total", fontSize = 13.sp)
                Text("₱${viewModel.lastFinalTotal.value.setScale(2, RoundingMode.HALF_UP)}", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = BrandColor)
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = BorderColor)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Remaining NFC Balance", fontSize = 12.sp, color = Ink2Color)
                Text("₱${viewModel.lastRemainingBalance.value.setScale(2, RoundingMode.HALF_UP)}", fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        }

        Spacer(Modifier.height(14.dp))
        PrimaryButton("⬇ Download Receipt PDF") { requestDownload() }
        Text(
            "Automatically saved to the phone's Download folder",
            fontSize = 10.5.sp, color = Ink3Color, textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp, bottom = 10.dp),
        )
        SecondaryButton("↗ Share / KakaoTalk") {
            // Shared as an image (not the PDF) so it renders inline in KakaoTalk in the
            // approved "Busan Mart" receipt design.
            val imageFile = PdfUtil.generateReceiptImage(context, receiptData)
            PdfUtil.shareImage(context, imageFile)
        }

        Spacer(Modifier.height(16.dp))
        SecondaryButton("Done") { onDone() }
    }
}

private fun downloadReceiptPdf(context: android.content.Context, data: ReceiptRenderer.ReceiptData) {
    val pdfFile = PdfUtil.generateReceiptPdf(context, data)
    val savedUri = PdfUtil.saveToDownloads(context, pdfFile, pdfFile.name, "application/pdf")
    if (savedUri != null) {
        Toast.makeText(context, "Downloads 폴더에 저장되었습니다: ${pdfFile.name}", Toast.LENGTH_LONG).show()
    } else {
        Toast.makeText(context, "저장에 실패했습니다. 저장 권한을 확인해 주세요.", Toast.LENGTH_LONG).show()
    }
}
