package com.smeag.mobilemart.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smeag.mobilemart.AppViewModel
import com.smeag.mobilemart.NfcEvent
import com.smeag.mobilemart.ui.components.*
import com.smeag.mobilemart.ui.theme.*
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Simple "total amount only" payment flow for PusanMart: pick "PUSANMART" from the store
 * selector at the top, type in the total amount, pick a discount, then tap the NFC card. On
 * tap, the card's NFCID + the cardholder's name (looked up the same way as Buyer Info) + the
 * store name + the final (post-discount) amount + the current date/time are written to the
 * `PusanmartPayments` table. There's no cart and no stock or balance changes — this is only a
 * payment log.
 */
@Composable
fun PusanmartPaymentScreen(viewModel: AppViewModel, nfcEvent: State<NfcEvent?>) {
    val storeOptions = listOf("Select Store", "PUSANMART")
    var selectedStore by remember { mutableStateOf(viewModel.pusanmartSelectedStore.value) }
    var amountText by remember { mutableStateOf(viewModel.pusanmartTotalAmount.value) }
    var awaitingTap by remember { mutableStateOf(false) }
    var lastHandledTs by remember { mutableStateOf(0L) }

    val storeMatched = viewModel.isPusanmartSearchMatched(selectedStore)
    val subtotal = amountText.toBigDecimalOrNull()
    val discountRate = viewModel.pusanmartDiscountRate.value
    val finalTotal = subtotal?.let { it.subtract(it.multiply(BigDecimal(discountRate))) }
    val canStartTap = storeMatched && finalTotal != null && finalTotal > BigDecimal.ZERO

    LaunchedEffect(nfcEvent.value) {
        val event = nfcEvent.value ?: return@LaunchedEffect
        if (!awaitingTap || event.ts == lastHandledTs) return@LaunchedEffect
        lastHandledTs = event.ts
        awaitingTap = false
        val amount = finalTotal ?: return@LaunchedEffect
        viewModel.submitPusanmartPayment(event.uid, amount) { }
    }

    Column(Modifier.fillMaxSize().background(BgColor).padding(18.dp)) {
        SectionEyebrow("PusanMart")
        ScreenTitle("PusanMart Payment")

        CampusDropdown(
            selected = selectedStore,
            options = storeOptions,
            onSelect = {
                selectedStore = it
                viewModel.pusanmartSelectedStore.value = it
                viewModel.pusanmartPaymentError.value = null
                viewModel.pusanmartPaymentSuccess.value = null
            },
            label = "Search Store",
        )

        if (!storeMatched) {
            Text(
                "Select \"PUSANMART\" to start a payment.",
                fontSize = 12.sp, color = Ink3Color,
                modifier = Modifier.padding(top = 4.dp),
            )
        } else {
            LabeledField(
                label = "Total Amount (PHP)",
                value = amountText,
                onChange = {
                    amountText = it
                    viewModel.pusanmartTotalAmount.value = it
                    viewModel.pusanmartPaymentError.value = null
                    viewModel.pusanmartPaymentSuccess.value = null
                },
                placeholder = "0.00",
                keyboardType = KeyboardType.Decimal,
            )

            Text("Discount", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = Ink2Color,
                modifier = Modifier.padding(bottom = 5.dp))
            Row(Modifier.fillMaxWidth().padding(bottom = 11.dp)) {
                PusanDiscountChip("No Discount", viewModel.pusanmartDiscountLabel.value == "No Discount") {
                    viewModel.pusanmartDiscountLabel.value = "No Discount"; viewModel.pusanmartDiscountRate.value = 0.0
                }
                Spacer(Modifier.width(8.dp))
                PusanDiscountChip("10% Discount", viewModel.pusanmartDiscountLabel.value == "10% Discount") {
                    viewModel.pusanmartDiscountLabel.value = "10% Discount"; viewModel.pusanmartDiscountRate.value = 0.10
                }
                Spacer(Modifier.width(8.dp))
                PusanDiscountChip("15% Discount", viewModel.pusanmartDiscountLabel.value == "15% Discount") {
                    viewModel.pusanmartDiscountLabel.value = "15% Discount"; viewModel.pusanmartDiscountRate.value = 0.15
                }
            }

            if (subtotal != null && finalTotal != null) {
                Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Total after discount", fontSize = 12.sp, color = Ink2Color)
                    Text("₱${finalTotal.setScale(2, RoundingMode.HALF_UP)}", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
            }

            viewModel.pusanmartPaymentSuccess.value?.let {
                Text(it, color = OkColor, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
            }
            viewModel.pusanmartPaymentError.value?.let {
                Text(it, color = OutColor, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
            }

            Spacer(Modifier.height(6.dp))

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(if (awaitingTap) OkBgColor else Surface2Color, RoundedCornerShape(14.dp))
                    .clickable(enabled = canStartTap && !viewModel.isSubmittingPusanmartPayment.value) {
                        awaitingTap = true
                    }
                    .padding(vertical = 16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("📶", fontSize = 24.sp)
                    Text(
                        when {
                            viewModel.isSubmittingPusanmartPayment.value -> "Saving payment..."
                            awaitingTap -> "Please tap your NFC card..."
                            !canStartTap -> "Enter a valid total amount first"
                            else -> "Tap your NFC card on the back of the phone"
                        },
                        fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    )
                    if (canStartTap) {
                        Text("Payment logs as soon as you tap", fontSize = 10.5.sp, color = Ink2Color)
                    }
                }
            }
        }
    }
}

@Composable
private fun RowScope.PusanDiscountChip(label: String, selected: Boolean, onClick: () -> Unit) {
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

private fun String.toBigDecimalOrNull(): BigDecimal? = try {
    if (isBlank()) null else BigDecimal(this)
} catch (e: Exception) { null }
