package com.smeag.mobilemart.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smeag.mobilemart.AppViewModel
import com.smeag.mobilemart.NfcEvent
import com.smeag.mobilemart.ui.components.SecondaryButton
import com.smeag.mobilemart.ui.theme.*
import java.math.RoundingMode

@Composable
fun BuyerScreen(viewModel: AppViewModel, nfcEvent: State<NfcEvent?>) {
    var lastHandledTs by remember { mutableStateOf(0L) }

    LaunchedEffect(nfcEvent.value) {
        val event = nfcEvent.value ?: return@LaunchedEffect
        if (event.ts == lastHandledTs) return@LaunchedEffect
        lastHandledTs = event.ts
        viewModel.lookupBuyer(event.uid)
    }

    Column(Modifier.fillMaxSize().background(BgColor).padding(18.dp)) {
        Text("BUYER INFO".uppercase(), fontSize = 10.5.sp, fontWeight = FontWeight.Bold, color = Ink3Color)
        Text("Buyer Info", fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 2.dp, bottom = 14.dp))

        Column(Modifier.fillMaxWidth().padding(vertical = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("📶", fontSize = 30.sp)
            Spacer(Modifier.height(6.dp))
            Text("Tap your NFC card on the back of the phone", fontSize = 11.5.sp, color = Ink3Color)
        }

        viewModel.buyerLookupError.value?.let {
            Text(it, color = OutColor, fontSize = 12.sp, modifier = Modifier.padding(bottom = 10.dp))
        }

        viewModel.buyerResult.value?.let { person ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(Surface2Color, RoundedCornerShape(14.dp))
                    .border(1.dp, BorderColor, RoundedCornerShape(14.dp))
                    .padding(16.dp),
            ) {
                Text(person.name ?: "-", fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
                Text("CARD ID · ${person.uid}", fontSize = 10.5.sp, color = Ink3Color, modifier = Modifier.padding(top = 2.dp))
                BuyerLine("Age", person.age?.toString() ?: "-")
                BuyerLine("Campus", person.campus ?: "-")
                BuyerLine("Start Date", person.startDate ?: "-")
                BuyerLine("End Date", person.endDate ?: "-")
                BuyerLine("E-MONEY", "₱${person.totalMoney.setScale(2, RoundingMode.HALF_UP)}", valueColor = BrandColor)
            }
        }

        Spacer(Modifier.height(14.dp))
        SecondaryButton("RESET") { viewModel.resetBuyer() }
    }
}

@Composable
private fun BuyerLine(label: String, value: String, valueColor: androidx.compose.ui.graphics.Color = InkColor) {
    androidx.compose.foundation.layout.Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 7.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, fontSize = 12.sp, color = Ink2Color)
        Text(value, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = valueColor)
    }
}
