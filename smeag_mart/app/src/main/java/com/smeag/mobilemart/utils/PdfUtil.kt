package com.smeag.mobilemart.utils

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.smeag.mobilemart.data.CartItem
import com.smeag.mobilemart.data.DbRepository
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Generates receipt/report PDFs and images, and saves them so the user can actually get to
 * them afterwards.
 *
 * IMPORTANT (fixes the "PDF Download button doesn't produce anything" bug): on Android 10+
 * (API 29+) apps can no longer write into the public Downloads folder as a plain File — the
 * old `context.getExternalFilesDir("Download")` path used previously writes into the app's
 * *private* sandbox (`Android/data/<package>/files/Download`), which does not show up in the
 * Files app, a file manager, or the Downloads app, even though the save call itself
 * "succeeds". [saveToDownloads] below uses MediaStore on API 29+ (and a direct public-folder
 * write + WRITE_EXTERNAL_STORAGE permission on API 26-28) so the file actually lands in the
 * real, user-visible Downloads folder.
 */
object PdfUtil {

    // ---------------------------------------------------------------------
    // Receipt (Sales -> Receipt screen)
    // ---------------------------------------------------------------------

    /** Renders the Busan-Mart-style receipt (see ReceiptRenderer) as a one-page PDF in the cache dir. */
    fun generateReceiptPdf(context: Context, data: ReceiptRenderer.ReceiptData): File {
        val height = ReceiptRenderer.computeHeight(data)
        val doc = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(ReceiptRenderer.WIDTH, height, 1).create()
        val page = doc.startPage(pageInfo)
        ReceiptRenderer.draw(page.canvas, data)
        doc.finishPage(page)

        val dir = File(context.cacheDir, "receipts").apply { mkdirs() }
        val file = File(dir, "receipt_${System.currentTimeMillis()}.pdf")
        FileOutputStream(file).use { doc.writeTo(it) }
        doc.close()
        return file
    }

    /** Renders the receipt as a PNG image (for sharing to KakaoTalk in the approved visual design). */
    fun generateReceiptImage(context: Context, data: ReceiptRenderer.ReceiptData): File {
        val bitmap = ReceiptRenderer.renderBitmap(data)
        val dir = File(context.cacheDir, "receipts").apply { mkdirs() }
        val file = File(dir, "receipt_${System.currentTimeMillis()}.png")
        FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        return file
    }

    // ---------------------------------------------------------------------
    // Report (Report screen -> "Download PDF")
    // ---------------------------------------------------------------------

    fun generateReportPdf(
        context: Context,
        campus: String,
        startDate: String,
        endDate: String,
        report: DbRepository.WeeklyReport,
    ): File {
        val title = Paint().apply { color = Color.BLACK; textSize = 20f; isFakeBoldText = true }
        val subtitle = Paint().apply { color = Color.DKGRAY; textSize = 13f }
        val section = Paint().apply { color = Color.rgb(0xE8, 0x5A, 0x24); textSize = 14f; isFakeBoldText = true }
        val label = Paint().apply { color = Color.DKGRAY; textSize = 12.5f }
        val value = Paint().apply { color = Color.BLACK; textSize = 12.5f; isFakeBoldText = true }
        val line = Paint().apply { color = Color.LTGRAY; strokeWidth = 1f }

        // Rough line-count-based height estimate, generous enough to avoid clipping.
        val estimatedLines = 10 + report.dailyTotals.size + report.topProducts.size + report.lowStock.size
        val pageWidth = 595 // A4-ish width in points
        val pageHeight = maxOf(842, 140 + estimatedLines * 22)

        val doc = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(pageWidth, pageHeight, 1).create()
        val page = doc.startPage(pageInfo)
        val canvas = page.canvas

        var y = 40f
        canvas.drawText("Sales Report", 30f, y, title); y += 22f
        canvas.drawText("$campus  •  $startDate ~ $endDate", 30f, y, subtitle); y += 28f
        canvas.drawLine(30f, y, pageWidth - 30f, y, line); y += 26f

        canvas.drawText("Summary", 30f, y, section); y += 22f
        fun row(l: String, v: String) {
            canvas.drawText(l, 30f, y, label)
            canvas.drawText(v, 260f, y, value)
            y += 20f
        }
        row("Total Revenue", "\u20B1${report.totalRevenue.setScale(0, RoundingMode.HALF_UP)}")
        row("Transactions", "${report.transactionCount}")
        row("Avg. Order Value", "\u20B1${report.avgOrderValue.setScale(2, RoundingMode.HALF_UP)}")
        row("Low Stock Alerts", "${report.lowStock.size}")
        y += 10f
        canvas.drawLine(30f, y, pageWidth - 30f, y, line); y += 26f

        canvas.drawText("Daily Sales", 30f, y, section); y += 22f
        report.dailyTotals.forEach { (date, amount) ->
            row(date, "\u20B1${amount.setScale(0, RoundingMode.HALF_UP)}")
        }
        y += 10f
        canvas.drawLine(30f, y, pageWidth - 30f, y, line); y += 26f

        canvas.drawText("Top Sellers (by Quantity)", 30f, y, section); y += 22f
        report.topProducts.forEachIndexed { idx, (name, qty) ->
            row("${idx + 1}. $name", "$qty")
        }
        y += 10f
        canvas.drawLine(30f, y, pageWidth - 30f, y, line); y += 26f

        canvas.drawText("Low Stock Items", 30f, y, section); y += 22f
        if (report.lowStock.isEmpty()) {
            canvas.drawText("None", 30f, y, label); y += 20f
        } else {
            report.lowStock.forEach { p ->
                row(p.sMenu ?: "-", "stock: ${p.stock}")
            }
        }

        doc.finishPage(page)
        val dir = File(context.cacheDir, "reports").apply { mkdirs() }
        val file = File(dir, "report_${System.currentTimeMillis()}.pdf")
        FileOutputStream(file).use { doc.writeTo(it) }
        doc.close()
        return file
    }

    // ---------------------------------------------------------------------
    // Saving to the real, user-visible Downloads folder
    // ---------------------------------------------------------------------

    /**
     * Copies [srcFile] into the public Downloads folder so it actually shows up for the user
     * (Files app, Downloads app, etc.), and returns the resulting content Uri, or null if it
     * couldn't be saved (e.g. legacy-storage permission not granted on API 26-28).
     */
    fun saveToDownloads(context: Context, srcFile: File, displayName: String, mimeType: String): Uri? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
            try {
                resolver.openOutputStream(uri)?.use { out: OutputStream -> srcFile.inputStream().use { it.copyTo(out) } }
                val updateValues = ContentValues().apply {
                    put(MediaStore.MediaColumns.IS_PENDING, 0)
                }
                resolver.update(uri, updateValues, null, null)
                uri
            } catch (e: Exception) {
                resolver.delete(uri, null, null)
                null
            }
        } else {
            // API 26-28: requires WRITE_EXTERNAL_STORAGE (declared maxSdkVersion=28 in the
            // manifest) to have been granted by the caller before this is invoked.
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (!downloadsDir.exists()) downloadsDir.mkdirs()
            val destFile = File(downloadsDir, displayName)
            try {
                FileOutputStream(destFile).use { out -> srcFile.inputStream().use { it.copyTo(out) } }
                android.media.MediaScannerConnection.scanFile(context, arrayOf(destFile.absolutePath), arrayOf(mimeType), null)
                FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", destFile)
            } catch (e: Exception) {
                null
            }
        }
    }

    fun hasLegacyStoragePermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return true
        return androidx.core.content.ContextCompat.checkSelfPermission(
            context, android.Manifest.permission.WRITE_EXTERNAL_STORAGE
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    // ---------------------------------------------------------------------
    // Sharing (KakaoTalk / system share sheet)
    // ---------------------------------------------------------------------

    /** Opens the system share sheet for a PDF (KakaoTalk will appear there if installed). */
    fun sharePdf(context: Context, file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "Share Receipt"))
    }

    /** Opens the system share sheet for a PNG image (renders inline as an image in KakaoTalk). */
    fun shareImage(context: Context, file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "Share Receipt"))
    }
}
