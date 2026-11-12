package com.smeag.mobilemart.utils

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import com.smeag.mobilemart.data.CartItem
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Draws the "Busan Mart" style receipt (per the approved design) onto any [Canvas] — the exact
 * same drawing code is used for the downloadable PDF (PdfUtil) and the receipt image shared to
 * KakaoTalk (ReceiptScreen), so the two always match.
 *
 * Notes (2026-07-19 revision): all receipt copy is in English, the business-registration-number
 * line is intentionally omitted, a "Remaining NFC Balance" line follows the total (larger type),
 * and the canvas is narrower + auto-sized taller so nothing (e.g. the footer) gets clipped.
 */
object ReceiptRenderer {

    const val WIDTH = 560
    private const val MARGIN = 34f

    /** Store contact info shown at the bottom of the receipt (same for every campus for now). */
    data class StoreInfo(
        val phone: String = "02-586-8677 / 63-32-520-9208",
        val address: String = "Emillio Osmena cor., Bataan St., Guadalupe, Cebu City 6000, Philippines",
    )

    private fun storeInfoFor(campus: String) = StoreInfo()

    data class ReceiptItem(
        val name: String,
        val category: String?,
        val quantity: Int,
        val lineTotal: BigDecimal,
    )

    data class ReceiptData(
        val campus: String,
        val nfcId: String,
        val purchaseDateTime: String,
        val approvalNumber: String,
        val items: List<ReceiptItem>,
        val finalTotal: BigDecimal,
        val remainingBalance: BigDecimal,
    ) {
        val storeInfo: StoreInfo get() = storeInfoFor(campus)
    }

    fun fromCart(
        campus: String,
        buyerUid: String,
        cart: List<CartItem>,
        finalTotal: BigDecimal,
        remainingBalance: BigDecimal,
        approvalNumber: String,
        transactionTimeMillis: Long,
    ): ReceiptData {
        val dateStr = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
            .format(Date(if (transactionTimeMillis > 0) transactionTimeMillis else System.currentTimeMillis()))
        val items = cart.map {
            ReceiptItem(
                name = "${it.product.sMenu ?: "-"} x ${it.quantity}",
                category = it.product.mMenu,
                quantity = it.quantity,
                lineTotal = it.lineTotal,
            )
        }
        return ReceiptData(
            campus = campus,
            nfcId = buyerUid,
            purchaseDateTime = dateStr,
            approvalNumber = approvalNumber,
            items = items,
            finalTotal = finalTotal,
            remainingBalance = remainingBalance,
        )
    }

    /** e.g. "PM260719-4821" — campus-initials + yyMMdd + a 4-digit number derived from the transaction time. */
    fun generateApprovalNumber(campus: String, transactionTimeMillis: Long): String {
        val prefix = campus.split(" ").mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifEmpty { "MT" }
        val datePart = SimpleDateFormat("yyMMdd", Locale.getDefault()).format(Date(transactionTimeMillis))
        val seq = (transactionTimeMillis % 10000L).toString().padStart(4, '0')
        return "$prefix$datePart-$seq"
    }

    /** Returns the total height needed to render [data] without clipping anything. */
    fun computeHeight(data: ReceiptData): Int = layout(null, data)

    fun renderBitmap(data: ReceiptData): Bitmap {
        val height = computeHeight(data)
        val bitmap = Bitmap.createBitmap(WIDTH, height, Bitmap.Config.ARGB_8888)
        draw(Canvas(bitmap), data)
        return bitmap
    }

    fun draw(canvas: Canvas, data: ReceiptData) {
        layout(canvas, data)
    }

    /** Wraps [text] to fit within [maxWidth] using [paint], breaking on spaces. */
    private fun wrapText(text: String, paint: Paint, maxWidth: Float): List<String> {
        if (text.isEmpty()) return emptyList()
        val words = text.split(" ")
        val lines = mutableListOf<String>()
        var current = StringBuilder()
        for (word in words) {
            val candidate = if (current.isEmpty()) word else "${current} $word"
            if (paint.measureText(candidate) > maxWidth && current.isNotEmpty()) {
                lines.add(current.toString())
                current = StringBuilder(word)
            } else {
                current = StringBuilder(candidate)
            }
        }
        if (current.isNotEmpty()) lines.add(current.toString())
        return lines
    }

    /**
     * Draws the receipt onto [canvas] if provided, and always returns the total height used —
     * so [computeHeight] (canvas = null) and [draw] (canvas != null) share one source of truth
     * and can never disagree about how tall the receipt needs to be.
     */
    private fun layout(canvas: Canvas?, data: ReceiptData): Int {
        val bg = Color.parseColor("#F1EFEA")
        val ink = Color.parseColor("#1D1D1B")
        val ink2 = Color.parseColor("#6B655C")
        val ink3 = Color.parseColor("#A39D93")
        val brand = Color.parseColor("#E85A24")
        val border = Color.parseColor("#DEDAD1")

        canvas?.drawColor(bg)

        val cx = WIDTH / 2f
        val storeTitle = Paint().apply { textSize = 30f; isFakeBoldText = true; typeface = Typeface.DEFAULT_BOLD; textAlign = Paint.Align.CENTER }
        val enTitle = Paint().apply { color = ink3; textSize = 13.5f; isFakeBoldText = true; textAlign = Paint.Align.CENTER; letterSpacing = 0.2f }
        val tagline = Paint().apply { color = ink3; textSize = 12.5f; textAlign = Paint.Align.CENTER }
        val label = Paint().apply { color = ink2; textSize = 13.5f }
        val value = Paint().apply { color = ink; textSize = 13.5f; isFakeBoldText = true; textAlign = Paint.Align.RIGHT }
        val itemName = Paint().apply { color = ink; textSize = 16f; isFakeBoldText = true }
        val itemSub = Paint().apply { color = ink3; textSize = 11.5f }
        val itemPrice = Paint().apply { color = ink; textSize = 16f; isFakeBoldText = true; textAlign = Paint.Align.RIGHT }
        val totalLabel = Paint().apply { color = ink; textSize = 19f; isFakeBoldText = true }
        val totalValue = Paint().apply { color = ink; textSize = 23f; isFakeBoldText = true; textAlign = Paint.Align.RIGHT }
        // Remaining NFC balance is called out larger/bolder than a normal info row, per request.
        val balanceLabel = Paint().apply { color = ink2; textSize = 16f; isFakeBoldText = true }
        val balanceValue = Paint().apply { color = brand; textSize = 19f; isFakeBoldText = true; textAlign = Paint.Align.RIGHT }
        val dashed = Paint().apply {
            color = border; strokeWidth = 1.5f
            pathEffect = android.graphics.DashPathEffect(floatArrayOf(6f, 6f), 0f)
        }
        val footerBold = Paint().apply { color = ink; textSize = 15f; isFakeBoldText = true; textAlign = Paint.Align.CENTER }
        val footerNormal = Paint().apply { color = ink2; textSize = 12.5f; textAlign = Paint.Align.CENTER }
        val addressValue = Paint().apply { color = ink; textSize = 13f; isFakeBoldText = true; textAlign = Paint.Align.RIGHT }

        var y = 54f

        fun text(t: String, x: Float, paint: Paint) { canvas?.drawText(t, x, y, paint) }
        fun hLine() { canvas?.drawLine(MARGIN, y, WIDTH - MARGIN, y, dashed) }

        // Two-tone store title: campus name in ink, trailing "Mart" (if present) in brand color.
        run {
            val full = data.campus
            val (part1, part2) = if (full.endsWith("Mart", ignoreCase = true) && full.length > 4) {
                full.dropLast(4).trimEnd() to full.takeLast(4)
            } else {
                full to ""
            }
            val w1 = storeTitle.measureText(part1)
            val w2 = if (part2.isNotEmpty()) storeTitle.measureText(" $part2") else 0f
            val total = w1 + w2
            var x = cx - total / 2f
            storeTitle.textAlign = Paint.Align.LEFT
            storeTitle.color = ink
            canvas?.drawText(part1, x, y, storeTitle); x += w1
            if (part2.isNotEmpty()) {
                storeTitle.color = brand
                canvas?.drawText(" $part2", x, y, storeTitle)
            }
            storeTitle.textAlign = Paint.Align.CENTER
        }
        y += 30f
        text(data.campus.uppercase(Locale.getDefault()), cx, enTitle)
        y += 26f
        for (line in wrapText("Self-checkout mini mart for campus students.", tagline, WIDTH - 2 * MARGIN)) {
            text(line, cx, tagline); y += 18f
        }
        text("Have a great day!", cx, tagline); y += 28f

        hLine(); y += 32f

        fun infoRow(l: String, v: String) {
            canvas?.drawText(l, MARGIN, y, label)
            canvas?.drawText(v, WIDTH - MARGIN, y, value)
            y += 28f
        }
        infoRow("Buyer NFC ID", data.nfcId)
        infoRow("Payment Method", "NFC Tag Payment")
        infoRow("Purchase Date/Time", data.purchaseDateTime)
        infoRow("Approval No.", data.approvalNumber)
        y += 6f

        hLine(); y += 40f

        for (item in data.items) {
            text(item.name, MARGIN, itemName)
            canvas?.drawText("\u20B1${item.lineTotal.setScale(0, RoundingMode.HALF_UP)}", WIDTH - MARGIN, y, itemPrice)
            y += 20f
            if (!item.category.isNullOrBlank()) {
                text(item.category, MARGIN, itemSub)
            }
            y += 46f
        }

        hLine(); y += 42f

        text("Total", MARGIN, totalLabel)
        canvas?.drawText("\u20B1${data.finalTotal.setScale(0, RoundingMode.HALF_UP)}", WIDTH - MARGIN, y, totalValue)
        y += 38f
        text("Remaining NFC Balance", MARGIN, balanceLabel)
        canvas?.drawText("\u20B1${data.remainingBalance.setScale(0, RoundingMode.HALF_UP)}", WIDTH - MARGIN, y, balanceValue)
        y += 38f

        hLine(); y += 32f

        infoRow("Store Name", data.campus)
        infoRow("Contact", data.storeInfo.phone)

        // Address is long, so it's right-aligned and wrapped across as many lines as it needs.
        canvas?.drawText("Address", MARGIN, y, label)
        val addressLines = wrapText(data.storeInfo.address, addressValue, WIDTH - 2 * MARGIN - 110f)
        addressLines.forEachIndexed { idx, line ->
            canvas?.drawText(line, WIDTH - MARGIN, y + idx * 18f, addressValue)
        }
        y += (maxOf(1, addressLines.size) - 1) * 18f + 28f

        hLine(); y += 34f

        text("Thank you", cx, footerBold); y += 20f
        text("We appreciate your business.", cx, footerNormal)
        y += 40f // bottom breathing room so the footer never sits flush against the edge

        return y.toInt()
    }
}
