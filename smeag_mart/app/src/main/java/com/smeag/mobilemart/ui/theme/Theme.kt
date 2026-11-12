package com.smeag.mobilemart.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val SmeagColorScheme = lightColorScheme(
    primary = BrandColor,
    onPrimary = SurfaceColor,
    secondary = Ink2Color,
    background = BgColor,
    surface = SurfaceColor,
    surfaceVariant = Surface2Color,
    onBackground = InkColor,
    onSurface = InkColor,
    error = OutColor,
)

val SmeagTypography = Typography(
    headlineSmall = TextStyle(fontWeight = FontWeight.ExtraBold, fontSize = 19.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.Bold, fontSize = 15.sp),
    bodyMedium = TextStyle(fontWeight = FontWeight.Normal, fontSize = 13.5.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp),
)

@Composable
fun SmeagMobileMartTheme(content: @Composable () -> Unit) {
    // Always light theme - matches the approved store-terminal mockup design.
    MaterialTheme(
        colorScheme = SmeagColorScheme,
        typography = SmeagTypography,
        content = content
    )
}
