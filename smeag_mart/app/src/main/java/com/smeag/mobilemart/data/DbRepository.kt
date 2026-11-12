package com.smeag.mobilemart.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.math.BigDecimal
import java.sql.Connection
import java.sql.DriverManager
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.LinkedHashMap
import java.util.Locale
import java.util.UUID

class DbRepository {

    init {
        try {
            Class.forName("org.mariadb.jdbc.Driver")
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun getConnection(): Connection {
        return DriverManager.getConnection(DbConfig.jdbcUrl(), DbConfig.USER, DbConfig.PASSWORD)
    }

    data class WeeklyReport(
        val totalRevenue: BigDecimal,
        val transactionCount: Int,
        val avgOrderValue: BigDecimal,
        val lowStock: List<StoreMenu>,
        val dailyTotals: List<Pair<String, BigDecimal>>,
        val topProducts: List<Pair<String, Int>>,
    )

    suspend fun fetchProducts(campus: String): List<StoreMenu> = withContext(Dispatchers.IO) {
        val list = mutableListOf<StoreMenu>()
        val hasCampusFilter = !campus.equals("All Campuses", ignoreCase = true) && campus.isNotBlank()
        val query = if (hasCampusFilter) {
            "SELECT id, Campus, m_menu, s_menu, image_path, payment, stock, sales_number, min_stock FROM store_menus WHERE UPPER(Campus) = ? OR UPPER(Campus) = 'ALL'"
        } else {
            "SELECT id, Campus, m_menu, s_menu, image_path, payment, stock, sales_number, min_stock FROM store_menus"
        }
        getConnection().use { conn ->
            conn.prepareStatement(query).use { stmt ->
                if (hasCampusFilter) {
                    stmt.setString(1, campus.uppercase())
                }
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        list.add(
                            StoreMenu(
                                id = rs.getInt("id"),
                                campus = rs.getString("Campus"),
                                mMenu = rs.getString("m_menu"),
                                sMenu = rs.getString("s_menu"),
                                imagePath = rs.getString("image_path"),
                                payment = rs.getBigDecimal("payment") ?: BigDecimal.ZERO,
                                stock = rs.getInt("stock"),
                                salesNumber = rs.getInt("sales_number"),
                                minStock = rs.getInt("min_stock")
                            )
                        )
                    }
                }
            }
        }
        list
    }

    suspend fun findPersonByUid(uid: String): Person? = withContext(Dispatchers.IO) {
        val query = "SELECT id, uid, studentid, name, age, gender, campus, s_date, e_date, totalmoney FROM person WHERE uid = ?"
        getConnection().use { conn ->
            conn.prepareStatement(query).use { stmt ->
                stmt.setString(1, uid)
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        Person(
                            id = rs.getInt("id"),
                            uid = rs.getString("uid") ?: "",
                            studentId = rs.getString("studentid"),
                            name = rs.getString("name"),
                            age = rs.getInt("age").takeUnless { rs.wasNull() },
                            gender = rs.getString("gender"),
                            campus = rs.getString("campus"),
                            startDate = rs.getDate("s_date")?.toString(),
                            endDate = rs.getDate("e_date")?.toString(),
                            totalMoney = rs.getBigDecimal("totalmoney") ?: BigDecimal.ZERO
                        )
                    } else {
                        null
                    }
                }
            }
        }
    }

    suspend fun login(loginId: String, password: String): MgPerson? = withContext(Dispatchers.IO) {
        val query = "SELECT id, login_id, name, position, campus FROM mgperson WHERE login_id = ? AND password = ?"
        getConnection().use { conn ->
            conn.prepareStatement(query).use { stmt ->
                stmt.setString(1, loginId)
                stmt.setString(2, password)
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        MgPerson(
                            id = rs.getInt("id"),
                            loginId = rs.getString("login_id") ?: "",
                            name = rs.getString("name") ?: "",
                            position = rs.getString("position") ?: "",
                            campus = rs.getString("campus") ?: ""
                        )
                    } else {
                        null
                    }
                }
            }
        }
    }

    suspend fun insertProduct(
        campus: String,
        mMenu: String,
        sMenu: String,
        imagePath: String?,
        price: BigDecimal,
        stock: Int,
        minStock: Int
    ): Boolean = withContext(Dispatchers.IO) {
        val query = "INSERT INTO store_menus (Campus, m_menu, s_menu, image_path, payment, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?)"
        getConnection().use { conn ->
            conn.prepareStatement(query).use { stmt ->
                stmt.setString(1, campus.uppercase())
                stmt.setString(2, mMenu)
                stmt.setString(3, sMenu)
                stmt.setString(4, imagePath)
                stmt.setBigDecimal(5, price)
                stmt.setInt(6, stock)
                stmt.setInt(7, minStock)
                stmt.executeUpdate() > 0
            }
        }
    }

    suspend fun updateProductStock(id: Int, stock: Int, minStock: Int, price: BigDecimal?): Boolean = withContext(Dispatchers.IO) {
        val query = if (price != null) {
            "UPDATE store_menus SET stock = ?, min_stock = ?, payment = ? WHERE id = ?"
        } else {
            "UPDATE store_menus SET stock = ?, min_stock = ? WHERE id = ?"
        }
        getConnection().use { conn ->
            conn.prepareStatement(query).use { stmt ->
                stmt.setInt(1, stock)
                stmt.setInt(2, minStock)
                if (price != null) {
                    stmt.setBigDecimal(3, price)
                    stmt.setInt(4, id)
                } else {
                    stmt.setInt(3, id)
                }
                stmt.executeUpdate() > 0
            }
        }
    }

    suspend fun deleteProduct(id: Int): Boolean = withContext(Dispatchers.IO) {
        val query = "DELETE FROM store_menus WHERE id = ?"
        getConnection().use { conn ->
            conn.prepareStatement(query).use { stmt ->
                stmt.setInt(1, id)
                stmt.executeUpdate() > 0
            }
        }
    }

    /**
     * Simple "total amount only" payment for PusanMart: no cart, no stock/balance tracking,
     * just a log of who tapped, how much, and when. Matches the `PusanmartPayments` table
     * (nfcid, center, name, allpayments, stock, register_days). `stock` isn't used by this
     * flow, so it's always recorded as 0.
     */
    suspend fun insertPusanmartPayment(
        nfcid: String,
        center: String,
        name: String,
        totalAmount: BigDecimal,
    ): Boolean = withContext(Dispatchers.IO) {
        val query = """
            INSERT INTO PusanmartPayments (nfcid, center, name, allpayments, stock, register_days)
            VALUES (?, ?, ?, ?, ?, ?)
        """.trimIndent()
        getConnection().use { conn ->
            conn.prepareStatement(query).use { stmt ->
                stmt.setString(1, nfcid)
                stmt.setString(2, center)
                stmt.setString(3, name)
                stmt.setBigDecimal(4, totalAmount)
                stmt.setInt(5, 0)
                stmt.setTimestamp(6, java.sql.Timestamp(System.currentTimeMillis()))
                stmt.executeUpdate() > 0
            }
        }
    }

    /**
     * Payment log list for the "PayList" screen: rows from `PusanmartPayments` where
     * `center` = "PusanMart", within the selected date range (inclusive, by `register_days`).
     */
    suspend fun fetchPusanmartPayments(startDate: String, endDate: String): List<PusanmartPaymentRecord> = withContext(Dispatchers.IO) {
        val list = mutableListOf<PusanmartPaymentRecord>()
        val query = """
            SELECT id, nfcid, center, name, allpayments, stock, register_days
            FROM PusanmartPayments
            WHERE center = 'PusanMart' AND register_days >= ? AND register_days <= ?
            ORDER BY register_days DESC, id DESC
        """.trimIndent()
        getConnection().use { conn ->
            conn.prepareStatement(query).use { stmt ->
                stmt.setString(1, "$startDate 00:00:00")
                stmt.setString(2, "$endDate 23:59:59")
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        list.add(
                            PusanmartPaymentRecord(
                                id = rs.getLong("id"),
                                nfcid = rs.getString("nfcid") ?: "",
                                center = rs.getString("center") ?: "",
                                name = rs.getString("name"),
                                allPayments = rs.getBigDecimal("allpayments") ?: BigDecimal.ZERO,
                                stock = rs.getInt("stock"),
                                registerDays = rs.getTimestamp("register_days")?.let {
                                    SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(it)
                                }
                            )
                        )
                    }
                }
            }
        }
        list
    }

    /** Result of a completed sale: what the buyer paid, and what's left on their NFC card. */
    data class CheckoutResult(
        val finalTotal: BigDecimal,
        val remainingBalance: BigDecimal,
    )

    suspend fun checkout(
        uid: String,
        studentId: String,
        buyerName: String?,
        campus: String,
        cart: List<CartItem>,
        discountLabel: String,
        discountRate: Double
    ): Result<CheckoutResult> = withContext(Dispatchers.IO) {
        runCatching {
            getConnection().use { conn ->
                conn.autoCommit = false
                try {
                    // 1. Get current buyer balance
                    var currentBalance = BigDecimal.ZERO
                    val selectBuyer = "SELECT totalmoney FROM person WHERE uid = ? FOR UPDATE"
                    conn.prepareStatement(selectBuyer).use { stmt ->
                        stmt.setString(1, uid)
                        stmt.executeQuery().use { rs ->
                            if (rs.next()) {
                                currentBalance = rs.getBigDecimal("totalmoney") ?: BigDecimal.ZERO
                            } else {
                                throw Exception("Buyer information not found.")
                            }
                        }
                    }

                    // 2. Calculate totals and check stocks
                    val cartSubtotal = cart.fold(BigDecimal.ZERO) { acc, item ->
                        acc.add(item.lineTotal)
                    }
                    val discountAmount = cartSubtotal.multiply(BigDecimal(discountRate))
                    val finalTotal = cartSubtotal.subtract(discountAmount)

                    if (currentBalance < finalTotal) {
                        throw Exception("Insufficient balance. (Current balance: ₱$currentBalance, required: ₱$finalTotal)")
                    }

                    val orderId = UUID.randomUUID().toString()
                    var remainingBalance = currentBalance

                    // 3. Process each item in cart
                    val selectStock = "SELECT stock, sales_number FROM store_menus WHERE id = ? FOR UPDATE"
                    val updateStock = "UPDATE store_menus SET stock = ?, sales_number = ? WHERE id = ?"
                    val insertBank = """
                        INSERT INTO bank (uid, studentid, name, campus, beforeamount, category, subcategory, 
                                          transaction_type, payment, totalmoney, quantity, transaction_source, remark, `order`) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'decrease', ?, ?, ?, 'Android POS', ?, ?)
                    """.trimIndent()

                    for (item in cart) {
                        var dbStock = 0
                        var dbSalesNum = 0
                        conn.prepareStatement(selectStock).use { stmt ->
                            stmt.setInt(1, item.product.id)
                            stmt.executeQuery().use { rs ->
                                if (rs.next()) {
                                    dbStock = rs.getInt("stock")
                                    dbSalesNum = rs.getInt("sales_number")
                                } else {
                                    throw Exception("Product not found: ${item.product.sMenu}")
                                }
                            }
                        }

                        if (dbStock < item.quantity) {
                            throw Exception("Insufficient stock: ${item.product.sMenu} (requested: ${item.quantity}, in stock: $dbStock)")
                        }

                        // Update product stock and sales count
                        conn.prepareStatement(updateStock).use { stmt ->
                            stmt.setInt(1, dbStock - item.quantity)
                            stmt.setInt(2, dbSalesNum + item.quantity)
                            stmt.setInt(3, item.product.id)
                            stmt.executeUpdate()
                        }

                        // Calculate line payment
                        val lineTotal = item.lineTotal
                        val lineDiscount = lineTotal.multiply(BigDecimal(discountRate))
                        val linePayment = lineTotal.subtract(lineDiscount)
                        
                        val beforeamountForLine = remainingBalance
                        val totalmoneyForLine = remainingBalance.subtract(linePayment)
                        remainingBalance = totalmoneyForLine

                        // Insert bank record
                        conn.prepareStatement(insertBank).use { stmt ->
                            stmt.setString(1, uid)
                            stmt.setString(2, studentId)
                            stmt.setString(3, buyerName)
                            stmt.setString(4, campus)
                            stmt.setBigDecimal(5, beforeamountForLine)
                            stmt.setString(6, "$campus Mart")
                            stmt.setString(7, item.product.sMenu)
                            stmt.setBigDecimal(8, linePayment)
                            stmt.setBigDecimal(9, totalmoneyForLine)
                            stmt.setInt(10, item.quantity)
                            stmt.setString(11, discountLabel)
                            stmt.setString(12, orderId)
                            stmt.executeUpdate()
                        }
                    }

                    // 4. Update buyer total money
                    val updateBuyer = "UPDATE person SET totalmoney = ? WHERE uid = ?"
                    conn.prepareStatement(updateBuyer).use { stmt ->
                        stmt.setBigDecimal(1, remainingBalance)
                        stmt.setString(2, uid)
                        stmt.executeUpdate()
                    }

                    conn.commit()
                    CheckoutResult(finalTotal = finalTotal, remainingBalance = remainingBalance)
                } catch (e: Exception) {
                    conn.rollback()
                    throw e
                }
            }
        }
    }

    suspend fun fetchHistory(campus: String, startDate: String, endDate: String): List<BankTransaction> = withContext(Dispatchers.IO) {
        val list = mutableListOf<BankTransaction>()
        val hasCampusFilter = !campus.equals("All Campuses", ignoreCase = true) && campus.isNotBlank()
        val query = if (hasCampusFilter) {
            """
                SELECT id, uid, studentid, name, campus, beforeamount, category, subcategory, 
                       transaction_type, payment, totalmoney, quantity, transaction_date, remark, transaction_source 
                FROM bank 
                WHERE transaction_date >= ? AND transaction_date <= ? AND UPPER(campus) = ?
                ORDER BY transaction_date DESC, id DESC
            """.trimIndent()
        } else {
            """
                SELECT id, uid, studentid, name, campus, beforeamount, category, subcategory, 
                       transaction_type, payment, totalmoney, quantity, transaction_date, remark, transaction_source 
                FROM bank 
                WHERE transaction_date >= ? AND transaction_date <= ?
                ORDER BY transaction_date DESC, id DESC
            """.trimIndent()
        }

        getConnection().use { conn ->
            conn.prepareStatement(query).use { stmt ->
                stmt.setString(1, "$startDate 00:00:00")
                stmt.setString(2, "$endDate 23:59:59")
                if (hasCampusFilter) {
                    stmt.setString(3, campus.uppercase())
                }
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        list.add(
                            BankTransaction(
                                id = rs.getLong("id"),
                                uid = rs.getString("uid") ?: "",
                                studentId = rs.getString("studentid") ?: "",
                                name = rs.getString("name"),
                                campus = rs.getString("campus"),
                                beforeAmount = rs.getBigDecimal("beforeamount") ?: BigDecimal.ZERO,
                                category = rs.getString("category"),
                                subcategory = rs.getString("subcategory"),
                                transactionType = rs.getString("transaction_type") ?: "decrease",
                                payment = rs.getBigDecimal("payment") ?: BigDecimal.ZERO,
                                totalMoney = rs.getBigDecimal("totalmoney") ?: BigDecimal.ZERO,
                                quantity = rs.getInt("quantity"),
                                transactionSource = rs.getString("transaction_source") ?: "office",
                                remark = rs.getString("remark"),
                                transactionDate = rs.getTimestamp("transaction_date")?.let {
                                    SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(it)
                                }
                            )
                        )
                    }
                }
            }
        }
        list
    }

    suspend fun fetchWeeklyReport(campus: String, startDate: String, endDate: String): WeeklyReport = withContext(Dispatchers.IO) {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val dailyMap = LinkedHashMap<String, BigDecimal>()
        try {
            val start = sdf.parse(startDate) ?: Date()
            val end = sdf.parse(endDate) ?: Date()
            val cal = Calendar.getInstance()
            cal.time = start
            while (!cal.time.after(end)) {
                dailyMap[sdf.format(cal.time)] = BigDecimal.ZERO
                cal.add(Calendar.DATE, 1)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        val hasCampusFilter = !campus.equals("All Campuses", ignoreCase = true) && campus.isNotBlank()

        var transactionCount = 0
        val lowStockList = mutableListOf<StoreMenu>()
        val topProductsList = mutableListOf<Pair<String, Int>>()

        getConnection().use { conn ->
            // 1. Daily totals
            val dailyQuery = if (hasCampusFilter) {
                """
                    SELECT DATE(transaction_date) as d, SUM(payment) as total 
                    FROM bank 
                    WHERE transaction_date >= ? AND transaction_date <= ? AND transaction_type = 'decrease' AND UPPER(campus) = ?
                    GROUP BY DATE(transaction_date)
                """.trimIndent()
            } else {
                """
                    SELECT DATE(transaction_date) as d, SUM(payment) as total 
                    FROM bank 
                    WHERE transaction_date >= ? AND transaction_date <= ? AND transaction_type = 'decrease'
                    GROUP BY DATE(transaction_date)
                """.trimIndent()
            }
            conn.prepareStatement(dailyQuery).use { stmt ->
                stmt.setString(1, "$startDate 00:00:00")
                stmt.setString(2, "$endDate 23:59:59")
                if (hasCampusFilter) {
                    stmt.setString(3, campus.uppercase())
                }
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        val d = rs.getDate("d")?.toString() ?: rs.getString("d")
                        val total = rs.getBigDecimal("total") ?: BigDecimal.ZERO
                        if (d != null && dailyMap.containsKey(d)) {
                            dailyMap[d] = total
                        }
                    }
                }
            }

            // 2. Transaction count
            val countQuery = if (hasCampusFilter) {
                "SELECT COUNT(DISTINCT COALESCE(`order`, id)) as cnt FROM bank WHERE transaction_date >= ? AND transaction_date <= ? AND transaction_type = 'decrease' AND UPPER(campus) = ?"
            } else {
                "SELECT COUNT(DISTINCT COALESCE(`order`, id)) as cnt FROM bank WHERE transaction_date >= ? AND transaction_date <= ? AND transaction_type = 'decrease'"
            }
            conn.prepareStatement(countQuery).use { stmt ->
                stmt.setString(1, "$startDate 00:00:00")
                stmt.setString(2, "$endDate 23:59:59")
                if (hasCampusFilter) {
                    stmt.setString(3, campus.uppercase())
                }
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        transactionCount = rs.getInt("cnt")
                    }
                }
            }

            // 3. Low stock
            val lowStockQuery = if (hasCampusFilter) {
                "SELECT id, Campus, m_menu, s_menu, image_path, payment, stock, sales_number, min_stock FROM store_menus WHERE (UPPER(Campus) = ? OR UPPER(Campus) = 'ALL') AND stock <= min_stock"
            } else {
                "SELECT id, Campus, m_menu, s_menu, image_path, payment, stock, sales_number, min_stock FROM store_menus WHERE stock <= min_stock"
            }
            conn.prepareStatement(lowStockQuery).use { stmt ->
                if (hasCampusFilter) {
                    stmt.setString(1, campus.uppercase())
                }
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        lowStockList.add(
                            StoreMenu(
                                id = rs.getInt("id"),
                                campus = rs.getString("Campus"),
                                mMenu = rs.getString("m_menu"),
                                sMenu = rs.getString("s_menu"),
                                imagePath = rs.getString("image_path"),
                                payment = rs.getBigDecimal("payment") ?: BigDecimal.ZERO,
                                stock = rs.getInt("stock"),
                                salesNumber = rs.getInt("sales_number"),
                                minStock = rs.getInt("min_stock")
                            )
                        )
                    }
                }
            }

            // 4. Top products
            val topProductsQuery = if (hasCampusFilter) {
                """
                    SELECT subcategory, SUM(quantity) as total_qty 
                    FROM bank 
                    WHERE transaction_date >= ? AND transaction_date <= ? AND transaction_type = 'decrease' AND UPPER(campus) = ?
                    GROUP BY subcategory 
                    ORDER BY total_qty DESC 
                    LIMIT 5
                """.trimIndent()
            } else {
                """
                    SELECT subcategory, SUM(quantity) as total_qty 
                    FROM bank 
                    WHERE transaction_date >= ? AND transaction_date <= ? AND transaction_type = 'decrease'
                    GROUP BY subcategory 
                    ORDER BY total_qty DESC 
                    LIMIT 5
                """.trimIndent()
            }
            conn.prepareStatement(topProductsQuery).use { stmt ->
                stmt.setString(1, "$startDate 00:00:00")
                stmt.setString(2, "$endDate 23:59:59")
                if (hasCampusFilter) {
                    stmt.setString(3, campus.uppercase())
                }
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        val name = rs.getString("subcategory") ?: "-"
                        val qty = rs.getInt("total_qty")
                        topProductsList.add(Pair(name, qty))
                    }
                }
            }
        }

        val totalRevenue = dailyMap.values.fold(BigDecimal.ZERO) { acc, v -> acc.add(v) }
        val avgOrderValue = if (transactionCount > 0) {
            totalRevenue.divide(BigDecimal(transactionCount), 2, java.math.RoundingMode.HALF_UP)
        } else {
            BigDecimal.ZERO
        }

        WeeklyReport(
            totalRevenue = totalRevenue,
            transactionCount = transactionCount,
            avgOrderValue = avgOrderValue,
            lowStock = lowStockList,
            dailyTotals = dailyMap.toList(),
            topProducts = topProductsList
        )
    }
}