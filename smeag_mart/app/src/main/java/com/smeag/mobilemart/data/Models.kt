package com.smeag.mobilemart.data

import java.math.BigDecimal

/** Matches `mgperson` table: store manager / admin accounts. */
data class MgPerson(
    val id: Int,
    val loginId: String,
    val name: String,
    val position: String,      // Admin, Manager, Security, StoreOrder
    val campus: String,        // Capital, Encanto, Talrac, Baydream
) {
    /** Manager gets 15% discount, teacher/security roles get 10% per proposal slide 8. */
    val discountRate: Double
        get() = when (position) {
            "Manager", "Admin" -> 0.15
            else -> 0.10
        }
}

/** Matches `person` table: student / buyer wallet-card holders. */
data class Person(
    val id: Int,
    val uid: String,           // NFC card UID
    val studentId: String?,
    val name: String?,
    val age: Int?,
    val gender: String?,
    val campus: String?,
    val startDate: String?,
    val endDate: String?,
    val totalMoney: BigDecimal,
)

/** Matches `store_menus` table: sellable products per campus. */
data class StoreMenu(
    val id: Int,
    val campus: String,
    val mMenu: String?,        // main category / store name
    val sMenu: String?,        // product name
    val imagePath: String?,
    val payment: BigDecimal,   // unit price
    val stock: Int,
    val salesNumber: Int,
    val minStock: Int,
) {
    val stockStatus: StockStatus
        get() = when {
            stock <= 0 -> StockStatus.OUT
            stock <= minStock -> StockStatus.LOW
            else -> StockStatus.OK
        }

    /** Loadable image URL for this product, or null if there's nothing to show. See [ImageConfig]. */
    val fullImageUrl: String?
        get() = ImageConfig.resolve(imagePath)
}

enum class StockStatus { OK, LOW, OUT }

/** Matches `bank` table: every sale / balance transaction. */
data class BankTransaction(
    val id: Long = 0,
    val uid: String,
    val studentId: String,
    val name: String?,
    val campus: String?,
    val beforeAmount: BigDecimal,
    val category: String?,          // e.g. "Capital Mart"
    val subcategory: String?,       // product name
    val transactionType: String,    // increase / decrease / exception
    val payment: BigDecimal,        // amount charged for this line
    val totalMoney: BigDecimal,     // balance after transaction
    val quantity: Int,
    val transactionSource: String = "Android POS",
    val remark: String? = null,
    val transactionDate: String? = null,
)

/** Matches `PusanmartPayments` table: one logged NFC tap payment at a `center` (e.g. "PusanMart"). */
data class PusanmartPaymentRecord(
    val id: Long,
    val nfcid: String,
    val center: String,
    val name: String?,
    val allPayments: BigDecimal,
    val stock: Int,
    val registerDays: String?,
)

/** One line item in the shopping cart on the Sales screen. */
data class CartItem(
    val product: StoreMenu,
    val quantity: Int,
) {
    val lineTotal: BigDecimal get() = product.payment.multiply(BigDecimal(quantity))
}
