package com.smeag.mobilemart

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smeag.mobilemart.data.CartItem
import com.smeag.mobilemart.data.DbRepository
import com.smeag.mobilemart.data.ImageEmbedder
import com.smeag.mobilemart.data.Person
import com.smeag.mobilemart.data.ProductPhotoMatcher
import com.smeag.mobilemart.data.SessionManager
import com.smeag.mobilemart.data.StoreMenu
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.math.BigDecimal

class AppViewModel : ViewModel() {
    val repo = DbRepository()

    // Sales screen state
    val products = mutableStateListOf<StoreMenu>()
    val cart = mutableStateListOf<CartItem>()

    // Set the default discount rate/label based on the logged-in manager's position
    private val loggedInManager get() = SessionManager.currentManager.value
    private fun defaultDiscountLabel(): String {
        val pos = loggedInManager?.position
        return if (pos == "Manager" || pos == "Admin") "Manager 15%" else "Teacher 10%"
    }
    private fun defaultDiscountRate(): Double {
        val pos = loggedInManager?.position
        return if (pos == "Manager" || pos == "Admin") 0.15 else 0.10
    }

    val discountLabel = mutableStateOf(defaultDiscountLabel())
    val discountRate = mutableStateOf(defaultDiscountRate())
    val isLoadingProducts = mutableStateOf(false)
    val checkoutError = mutableStateOf<String?>(null)

    // Last completed sale, shown on the Receipt screen
    val lastCart = mutableStateListOf<CartItem>()
    val lastDiscountLabel = mutableStateOf("")
    val lastDiscountRate = mutableStateOf(0.0)
    val lastFinalTotal = mutableStateOf(BigDecimal.ZERO)
    val lastRemainingBalance = mutableStateOf(BigDecimal.ZERO)
    val lastBuyerUid = mutableStateOf("")
    val lastBuyerName = mutableStateOf<String?>(null)
    val lastApprovalNumber = mutableStateOf("")
    val lastTransactionTimeMillis = mutableStateOf(0L)

    // Buyer info screen state
    val buyerResult = mutableStateOf<Person?>(null)
    val buyerLookupError = mutableStateOf<String?>(null)

    fun loadProducts(campus: String, context: Context? = null) {
        viewModelScope.launch {
            isLoadingProducts.value = true
            runCatching { repo.fetchProducts(campus) }
                .onSuccess { products.clear(); products.addAll(it) }
            isLoadingProducts.value = false
            // Best-effort background refresh of the photo-matching index so newly registered
            // or re-photographed products are ready to be matched next time someone uses
            // "find by photo" on the Sales screen. Doesn't block the product list from showing.
            if (context != null) {
                launch {
                    // Invalidate the in-memory cache first — the embedding algorithm (power
                    // normalisation + Top-K masking) changed, so any vectors from a previous
                    // build are stale. The dimension-mismatch check in ProductPhotoMatcher
                    // handles on-disk invalidation; this call clears in-memory state.
                    ProductPhotoMatcher.invalidateCache()
                    ProductPhotoMatcher.sync(context.applicationContext, products.toList())
                }
            }
        }
    }


    fun addToCart(product: StoreMenu) {
        val idx = cart.indexOfFirst { it.product.id == product.id }
        if (idx >= 0) {
            cart[idx] = cart[idx].copy(quantity = cart[idx].quantity + 1)
        } else {
            cart.add(CartItem(product, 1))
        }
    }

    fun changeQuantity(product: StoreMenu, delta: Int) {
        val idx = cart.indexOfFirst { it.product.id == product.id }
        if (idx < 0) return
        val newQty = cart[idx].quantity + delta
        if (newQty <= 0) cart.removeAt(idx) else cart[idx] = cart[idx].copy(quantity = newQty)
    }

    val cartSubtotal: BigDecimal get() = cart.fold(BigDecimal.ZERO) { acc, i -> acc + i.lineTotal }
    val cartTotalAfterDiscount: BigDecimal
        get() = cartSubtotal.subtract(cartSubtotal.multiply(BigDecimal(discountRate.value)))

    /** Called once an NFC card UID is captured on the Sales screen. */
    fun checkoutWithUid(uid: String, campus: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            val person = try {
                repo.findPersonByUid(uid)
            } catch (e: Exception) {
                checkoutError.value = "An error occurred during checkout: ${e.message ?: "Unknown error"}"
                onDone(false)
                return@launch
            }
            if (person == null) {
                checkoutError.value = "This NFC card is not registered."
                onDone(false)
                return@launch
            }
            val result = repo.checkout(
                uid = uid,
                studentId = person.studentId ?: "",
                buyerName = person.name,
                campus = campus,
                cart = cart.toList(),
                discountLabel = discountLabel.value,
                discountRate = discountRate.value,
            )
            result.onSuccess { checkoutResult ->
                lastCart.clear(); lastCart.addAll(cart)
                lastDiscountLabel.value = discountLabel.value
                lastDiscountRate.value = discountRate.value
                lastFinalTotal.value = checkoutResult.finalTotal
                lastRemainingBalance.value = checkoutResult.remainingBalance
                lastBuyerUid.value = uid
                lastBuyerName.value = person.name
                val now = System.currentTimeMillis()
                lastTransactionTimeMillis.value = now
                lastApprovalNumber.value = com.smeag.mobilemart.utils.ReceiptRenderer.generateApprovalNumber(campus, now)
                cart.clear()
                loadProducts(campus)
                onDone(true)
            }.onFailure {
                checkoutError.value = it.message
                onDone(false)
            }
        }
    }

    fun lookupBuyer(uid: String) {
        viewModelScope.launch {
            buyerLookupError.value = null
            val person = try {
                repo.findPersonByUid(uid)
            } catch (e: Exception) {
                buyerLookupError.value = "An error occurred during lookup: ${e.message ?: "Unknown error"}"
                null
            }
            if (person == null && buyerLookupError.value == null) buyerLookupError.value = "This card is not registered."
            buyerResult.value = person
        }
    }

    fun resetBuyer() {
        buyerResult.value = null
        buyerLookupError.value = null
    }

    // PusanMart "total amount only" payment screen state
    val pusanmartSelectedStore = mutableStateOf("Select Store")
    val pusanmartTotalAmount = mutableStateOf("")
    val pusanmartDiscountLabel = mutableStateOf("No Discount")
    val pusanmartDiscountRate = mutableStateOf(0.0)
    val isSubmittingPusanmartPayment = mutableStateOf(false)
    val pusanmartPaymentError = mutableStateOf<String?>(null)
    val pusanmartPaymentSuccess = mutableStateOf<String?>(null)

    /** Only the "PUSANMART" store option unlocks the amount + NFC step. */
    fun isPusanmartSearchMatched(selectedStore: String): Boolean =
        selectedStore.trim().replace(" ", "").equals("PUSANMART", ignoreCase = true)

    /**
     * Called once an NFC card UID is captured on the PusanMart payment screen. Looks up the
     * cardholder's name (same as Buyer Info / normal checkout), then logs the amount typed in
     * against that card into `PusanmartPayments` — no cart, no stock, no balance changes.
     */
    fun submitPusanmartPayment(uid: String, totalAmount: BigDecimal, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            pusanmartPaymentError.value = null
            pusanmartPaymentSuccess.value = null
            isSubmittingPusanmartPayment.value = true

            val person = try {
                repo.findPersonByUid(uid)
            } catch (e: Exception) {
                pusanmartPaymentError.value = "An error occurred during lookup: ${e.message ?: "Unknown error"}"
                isSubmittingPusanmartPayment.value = false
                onDone(false)
                return@launch
            }
            if (person == null) {
                pusanmartPaymentError.value = "This NFC card is not registered."
                isSubmittingPusanmartPayment.value = false
                onDone(false)
                return@launch
            }

            val ok = try {
                repo.insertPusanmartPayment(
                    nfcid = uid,
                    center = "PusanMart",
                    name = person.name ?: "",
                    totalAmount = totalAmount,
                )
            } catch (e: Exception) {
                pusanmartPaymentError.value = "An error occurred while saving the payment: ${e.message ?: "Unknown error"}"
                false
            }

            isSubmittingPusanmartPayment.value = false
            if (ok) {
                pusanmartPaymentSuccess.value = "Recorded ₱${totalAmount.setScale(2, java.math.RoundingMode.HALF_UP)} for ${person.name ?: uid}."
                pusanmartTotalAmount.value = ""
            } else if (pusanmartPaymentError.value == null) {
                pusanmartPaymentError.value = "Failed to save the payment."
            }
            onDone(ok)
        }
    }

    // Sales screen "find product by photo" state
    val isMatchingPhoto = mutableStateOf(false)
    val photoMatchMessage = mutableStateOf<String?>(null)

    /**
     * Minimum cosine similarity to treat a photo match as confident enough to act on
     * automatically.
     *
     * v7 background suppression: Lowered threshold to 0.45f to prioritize high recall
     * (recall over precision) so that any product that looks roughly similar to the capture
     * is automatically registered and added to the cart.
     */
    private val MATCH_THRESHOLD = 0.45f

    /**
     * Takes a photo captured on the Sales screen, finds the most visually similar registered
     * product, and — since it cleared the confidence threshold — adds it straight to the cart.
     * Sets [photoMatchMessage] either way so the UI can show what happened (a low/no match is
     * reported rather than silently doing nothing, so the cashier isn't left guessing).
     */
    private data class PhotoMatchOutcome(val match: ProductPhotoMatcher.MatchResult?, val error: String?)

    fun matchProductPhoto(context: Context, bitmap: Bitmap) {
        viewModelScope.launch {
            isMatchingPhoto.value = true
            photoMatchMessage.value = null
            val appContext = context.applicationContext

            // Model loading, network image downloads, and TFLite inference are all
            // blocking/CPU work — none of it belongs on the main thread.
            val outcome = withContext(Dispatchers.IO) {
                if (!ImageEmbedder.isAvailable(appContext)) {
                    return@withContext PhotoMatchOutcome(null, "Photo matching isn't available on this build (model missing).")
                }
                // Make sure anything registered/re-photographed very recently is indexed
                // before we search, not just at the last product-list load.
                ProductPhotoMatcher.sync(appContext, products.toList())

                val embedding = try {
                    ImageEmbedder.embed(appContext, bitmap)
                } catch (e: Exception) {
                    return@withContext PhotoMatchOutcome(null, "사진 분석 중 오류가 발생했습니다: ${e.message ?: "알 수 없는 오류"}")
                }
                val result = ProductPhotoMatcher.findBestMatch(appContext, embedding, products.toList())
                // 개발 중 유사도 확인용 — 실기기 logcat에서 "PhotoMatch" 태그로 확인하세요
                android.util.Log.d("PhotoMatch", "Best match: ${result?.product?.sMenu} similarity=${result?.similarity}")
                PhotoMatchOutcome(result, null)
            }

            val match = outcome.match
            when {
                outcome.error != null -> photoMatchMessage.value = outcome.error
                match == null || match.similarity < MATCH_THRESHOLD -> {
                    val pct = match?.let { (it.similarity * 100).toInt() }
                    photoMatchMessage.value = if (pct != null)
                        "일치하는 상품을 찾지 못했습니다 (가장 가까운 상품 유사도: ${pct}%). 직접 상품을 선택해 주세요."
                    else
                        "일치하는 상품을 찾지 못했습니다. 직접 상품을 선택해 주세요."
                }
                else -> {
                    addToCart(match.product)
                    photoMatchMessage.value = "\"${match.product.sMenu}\"이(가) 장바구니에 추가되었습니다 (유사도: ${(match.similarity * 100).toInt()}%)."
                }
            }
            isMatchingPhoto.value = false
        }
    }
}
