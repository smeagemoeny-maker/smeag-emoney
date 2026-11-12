package com.smeag.mobilemart.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.smeag.mobilemart.data.StockStatus
import com.smeag.mobilemart.ui.theme.*

@Composable
fun SectionEyebrow(text: String) {
    Text(
        text.uppercase(),
        color = Ink3Color,
        fontSize = 10.5.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.sp,
    )
}

@Composable
fun ScreenTitle(text: String) {
    Text(text, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, color = InkColor,
        modifier = Modifier.padding(top = 2.dp, bottom = 14.dp))
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(containerColor = BrandColor, contentColor = Color.White),
        shape = RoundedCornerShape(12.dp),
        modifier = modifier.fillMaxWidth().height(46.dp),
    ) { Text(text, fontWeight = FontWeight.Bold, fontSize = 13.5.sp) }
}

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.outlinedButtonColors(containerColor = Surface2Color, contentColor = InkColor),
        border = BorderStroke(1.dp, BorderStrongColor),
        shape = RoundedCornerShape(12.dp),
        modifier = modifier.fillMaxWidth().height(46.dp),
    ) { Text(text, fontWeight = FontWeight.Bold, fontSize = 13.5.sp) }
}

@Composable
fun SmeagCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Surface2Color, RoundedCornerShape(14.dp))
            .border(1.dp, BorderColor, RoundedCornerShape(14.dp))
            .padding(12.dp),
        content = content,
    )
}

@Composable
fun StockBadge(status: StockStatus) {
    val (bg, fg, label) = when (status) {
        StockStatus.OK -> Triple(OkBgColor, OkColor, "OK")
        StockStatus.LOW -> Triple(LowBgColor, LowColor, "LOW")
        StockStatus.OUT -> Triple(OutBgColor, OutColor, "OUT")
    }
    Box(
        modifier = Modifier.background(bg, RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 3.dp)
    ) { Text(label, color = fg, fontSize = 10.5.sp, fontWeight = FontWeight.Bold) }
}

/**
 * Product photo thumbnail. Shows the real image when [imageUrl] resolves to
 * something loadable (see [com.smeag.mobilemart.data.ImageConfig]); falls
 * back to a plain placeholder box when there's no URL or the load fails.
 */
@Composable
fun ProductThumbnail(imageUrl: String?, modifier: Modifier = Modifier.size(52.dp), iconSize: Dp = 20.dp) {
    val shape = RoundedCornerShape(8.dp)
    Box(
        modifier = modifier.clip(shape).background(BorderColor, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (imageUrl != null) {
            AsyncImage(
                model = imageUrl,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        } else {
            Text("📦", fontSize = iconSize.value.sp)
        }
    }
}

@Composable
fun CampusDropdown(
    selected: String,
    options: List<String>,
    onSelect: (String) -> Unit,
    label: String = "Campus",
) {
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(bottom = 11.dp)) {
        Text(label, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = Ink2Color,
            modifier = Modifier.padding(bottom = 5.dp))
        Box {
            SecondaryButton(text = selected) { expanded = true }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { opt ->
                    DropdownMenuItem(text = { Text(opt) }, onClick = { onSelect(opt); expanded = false })
                }
            }
        }
    }
}

/**
 * Read-only date field that opens the native Android date picker on tap, instead of letting
 * the user type a date by hand. [value] and the value passed to [onChange] are "yyyy-MM-dd".
 */
@Composable
fun DateSelectField(label: String, value: String, onChange: (String) -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val sdf = remember { java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()) }

    fun openPicker() {
        val cal = java.util.Calendar.getInstance()
        runCatching { sdf.parse(value) }.getOrNull()?.let { cal.time = it }
        android.app.DatePickerDialog(
            context,
            { _, year, month, dayOfMonth ->
                val picked = java.util.Calendar.getInstance()
                picked.set(year, month, dayOfMonth)
                onChange(sdf.format(picked.time))
            },
            cal.get(java.util.Calendar.YEAR),
            cal.get(java.util.Calendar.MONTH),
            cal.get(java.util.Calendar.DAY_OF_MONTH),
        ).show()
    }

    Column(Modifier.fillMaxWidth().padding(bottom = 11.dp)) {
        Text(label, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = Ink2Color,
            modifier = Modifier.padding(bottom = 5.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(Surface2Color, RoundedCornerShape(10.dp))
                .border(1.dp, BorderStrongColor, RoundedCornerShape(10.dp))
                .clickable { openPicker() }
                .padding(horizontal = 14.dp, vertical = 13.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Text(value.ifBlank { "Select date" }, fontSize = 13.sp, color = if (value.isBlank()) Ink3Color else InkColor)
                Text("📅", fontSize = 13.sp)
            }
        }
    }
}

@Composable
fun LabeledField(label: String, value: String, onChange: (String) -> Unit, placeholder: String = "", keyboardType: androidx.compose.ui.text.input.KeyboardType = androidx.compose.ui.text.input.KeyboardType.Text) {
    Column(Modifier.fillMaxWidth().padding(bottom = 11.dp)) {
        Text(label, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = Ink2Color,
            modifier = Modifier.padding(bottom = 5.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text(placeholder, color = Ink3Color) },
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = keyboardType),
            singleLine = true,
            shape = RoundedCornerShape(10.dp),
            colors = OutlinedTextFieldDefaults.colors(
                unfocusedContainerColor = Surface2Color,
                focusedContainerColor = Surface2Color,
                unfocusedBorderColor = BorderStrongColor,
                focusedBorderColor = BrandColor,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}



