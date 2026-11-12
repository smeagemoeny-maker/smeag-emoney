package com.smeag.mobilemart.utils

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.math.BigDecimal
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Minimal but spec-complete .xlsx (OOXML spreadsheet) writer with zero external dependencies —
 * just enough to emit a single-sheet workbook with inline-string / numeric cells that real
 * Excel (desktop and mobile) will open without a "can't read this file" error. This is
 * intentionally not a general-purpose Excel library (no cell styling beyond the required
 * default, no formulas, no multiple sheets) — it exists so simple list/report exports like
 * PayList's "Download Excel" button don't need to pull in a heavy dependency (e.g. Apache POI,
 * which is awkward on Android) for what is fundamentally a flat table dump.
 *
 * IMPORTANT: an earlier version of this file omitted `xl/styles.xml` and the `docProps` parts.
 * parts. That produces a .zip that's technically parseable (tools like openpyxl will open it
 * fine) but real Excel treats the styles part as required, not optional, and will refuse to
 * open the file at all rather than just showing a "repair?" prompt. All parts below are the
 * full set real Excel expects for a package to be considered well-formed.
 */
object ExcelUtil {

    /** One cell for [writeSimpleSheet]: either a plain string or a number. */
    sealed class Cell {
        data class Text(val value: String) : Cell()
        data class Number(val value: BigDecimal) : Cell()
    }

    fun text(value: String): Cell = Cell.Text(value)
    fun number(value: BigDecimal): Cell = Cell.Number(value)

    private fun escapeXml(s: String): String = s
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&apos;")

    private fun colLetter(index: Int): String {
        var i = index
        val sb = StringBuilder()
        while (i >= 0) {
            sb.insert(0, ('A' + (i % 26)))
            i = i / 26 - 1
        }
        return sb.toString()
    }

    private fun cellXml(rowIndex: Int, colIndex: Int, cell: Cell): String {
        val ref = "${colLetter(colIndex)}$rowIndex"
        return when (cell) {
            is Cell.Text -> "<c r=\"$ref\" t=\"inlineStr\"><is><t xml:space=\"preserve\">${escapeXml(cell.value)}</t></is></c>"
            is Cell.Number -> "<c r=\"$ref\"><v>${cell.value.toPlainString()}</v></c>"
        }
    }

    /**
     * Writes [rows] (each a list of [Cell]) as a single-sheet .xlsx into the app cache dir and
     * returns the resulting file. [sheetName] is cosmetic only (shows as the tab name in Excel).
     */
    fun writeSimpleSheet(context: Context, fileNamePrefix: String, sheetName: String, rows: List<List<Cell>>): File {
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        val file = File(dir, "${fileNamePrefix}_${System.currentTimeMillis()}.xlsx")

        val colCount = (rows.maxOfOrNull { it.size } ?: 1).coerceAtLeast(1)
        val rowCount = rows.size.coerceAtLeast(1)
        val dimensionRef = "A1:${colLetter(colCount - 1)}$rowCount"

        val sheetRowsXml = buildString {
            rows.forEachIndexed { rIdx, row ->
                val rowNum = rIdx + 1
                append("<row r=\"$rowNum\">")
                row.forEachIndexed { cIdx, cell -> append(cellXml(rowNum, cIdx, cell)) }
                append("</row>")
            }
        }

        val contentTypes = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""

        val rootRels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""

        val workbookXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>"""

        val workbookRels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""

        // Minimal but complete styles part: one default font/fill/border and one cell format
        // (xf index 0), which every cell in the sheet implicitly uses. Excel requires this part
        // to be present even when nothing is actually styled.
        val stylesXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>"""

        val sheetXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="$dimensionRef"/>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<sheetData>$sheetRowsXml</sheetData>
</worksheet>"""

        val coreXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>SMEAG Mobile Mart</dc:creator>
<cp:lastModifiedBy>SMEAG Mobile Mart</cp:lastModifiedBy>
</cp:coreProperties>"""

        val appXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>SMEAG Mobile Mart</Application>
</Properties>"""

        ZipOutputStream(FileOutputStream(file)).use { zip ->
            fun put(name: String, content: String) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(content.toByteArray(Charsets.UTF_8))
                zip.closeEntry()
            }
            put("[Content_Types].xml", contentTypes)
            put("_rels/.rels", rootRels)
            put("docProps/core.xml", coreXml)
            put("docProps/app.xml", appXml)
            put("xl/workbook.xml", workbookXml)
            put("xl/_rels/workbook.xml.rels", workbookRels)
            put("xl/styles.xml", stylesXml)
            put("xl/worksheets/sheet1.xml", sheetXml)
        }
        return file
    }

    const val MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}
