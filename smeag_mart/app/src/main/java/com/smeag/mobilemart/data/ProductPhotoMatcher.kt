package com.smeag.mobilemart.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import coil.imageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Builds and maintains an on-device "index" of embedding vectors (see [ImageEmbedder]) for every
 * registered product photo, and matches a freshly-taken Sales-screen photo against it.
 *
 * Why cache at all: computing an embedding means downloading the full-size photo over HTTP and
 * running it through the model — repeating that for every product on every single sale would make
 * "find by photo" too slow to be usable at a checkout counter. Instead this keeps one embedding
 * per product on disk, keyed by that product's current `imagePath`, and only (re)computes an
 * entry when it's missing or the photo has changed (Modify screen swapped the image, e.g.).
 *
 * Cache invalidation (v2): if the model was swapped for a new one with a different output size
 * (e.g. replacing the 1001-dim classification model with a 1280-dim feature-vector model), the
 * stored vectors have a different dimension than what [ImageEmbedder.embeddingSize] reports. In
 * that case the entire cache is discarded and rebuilt automatically so stale vectors never
 * silently produce garbage similarity scores.
 */
object ProductPhotoMatcher {
    private const val CACHE_FILE_NAME = "product_embeddings.cache"

    /**
     * Increment this whenever the embedding algorithm changes.
     *
     * Current version 7: Background-Suppressed Central 60% Attention —
     *                    centre 60% area × 1.0, background 40% × 0.1,
     *                    log-power, Top-15, spatial colour + gradient.
     */
    private const val CACHE_VERSION = 7

    data class MatchResult(val product: StoreMenu, val similarity: Float)

    private data class CachedEmbedding(val imagePath: String, val vector: FloatArray)

    // productId -> cached embedding. Loaded from disk lazily, then kept in memory.
    private var cache: MutableMap<Int, CachedEmbedding>? = null

    private fun cacheFile(context: Context) = File(context.filesDir, CACHE_FILE_NAME)


    /**
     * Loads the on-disk cache.
     * Two automatic invalidation checks:
     *   (a) Version header mismatch: the first line of the cache file stores "#version=N";
     *       if N ≠ CACHE_VERSION the file was written by an older algorithm and is deleted.
     *   (b) Dimension mismatch: any stored vector whose length ≠ ImageEmbedder.embeddingSize
     *       indicates the model was swapped — the whole file is deleted in that case too.
     * Both checks result in an empty map so sync() will rebuild the cache from scratch.
     */
    private fun loadCache(context: Context): MutableMap<Int, CachedEmbedding> {
        cache?.let { return it }
        val loaded = mutableMapOf<Int, CachedEmbedding>()
        val file = cacheFile(context)
        if (file.exists()) {
            var versionOk = false
            runCatching {
                file.bufferedReader().useLines { seq ->
                    val lines = seq.iterator()
                    // First line must be the version header; anything else = old format = stale.
                    if (lines.hasNext()) {
                        val header = lines.next()
                        versionOk = header == "#version=$CACHE_VERSION"
                    }
                    if (versionOk) {
                        for (line in lines) {
                            val parts = line.split("|")
                            if (parts.size != 3) continue
                            val id = parts[0].toIntOrNull() ?: continue
                            val vector = parts[2].split(",").map { it.toFloat() }.toFloatArray()
                            loaded[id] = CachedEmbedding(parts[1], vector)
                        }
                    }
                }
            }

            val shouldWipe = !versionOk ||
                loaded.values.any { it.vector.size != ImageEmbedder.embeddingSize }
            if (shouldWipe) {
                runCatching { file.delete() }
                loaded.clear()
            }
        }
        cache = loaded
        return loaded
    }

    /** Invalidates the in-memory cache (forces a reload from disk on the next call). */
    fun invalidateCache() {
        cache = null
    }

    private fun persistCache(context: Context, map: Map<Int, CachedEmbedding>) {
        runCatching {
            cacheFile(context).bufferedWriter().use { writer ->
                // Write version header as the first line so future loads can detect staleness.
                writer.write("#version=$CACHE_VERSION")
                writer.newLine()
                for ((id, entry) in map) {
                    writer.write("$id|${entry.imagePath}|${entry.vector.joinToString(",")}")
                    writer.newLine()
                }
            }
        }
    }

    /**
     * Downloads and embeds any product photo that isn't already cached (or whose stored path
     * changed since last time), for every product in [products] that has an image. Safe to call
     * often (e.g. whenever the Sales screen's product list (re)loads) — already-cached, unchanged
     * products are skipped in O(1), so a repeat call with nothing new to do is nearly free.
     *
     * Best-effort: a single product's photo failing to download/embed (bad network, 404, etc.)
     * is skipped rather than aborting the whole sync, since one broken image shouldn't block
     * matching for every other product.
     */
    suspend fun sync(context: Context, products: List<StoreMenu>) = withContext(Dispatchers.IO) {
        if (!ImageEmbedder.isAvailable(context)) return@withContext
        val map = loadCache(context)
        var changed = false

        for (product in products) {
            val path = product.imagePath?.takeIf { it.isNotBlank() } ?: continue
            val url = product.fullImageUrl ?: continue
            val existing = map[product.id]
            if (existing != null && existing.imagePath == path) continue // already up to date

            val bitmap = fetchBitmap(context, url) ?: continue
            val vector = try {
                ImageEmbedder.embed(context, bitmap)
            } catch (e: Exception) {
                continue
            }
            map[product.id] = CachedEmbedding(path, vector)
            changed = true
        }

        // Drop entries for products that no longer exist, so the cache doesn't grow forever.
        val currentIds = products.map { it.id }.toSet()
        if (map.keys.retainAll(currentIds)) changed = true

        if (changed) persistCache(context, map)
    }

    /**
     * Compares [photoEmbedding] against every cached product embedding and returns the closest
     * match together with its similarity score (cosine similarity, roughly 0..1 in practice for
     * real photos), or null if nothing is cached yet. Callers decide what similarity threshold
     * counts as "confident enough" to act on.
     */
    fun findBestMatch(context: Context, photoEmbedding: FloatArray, products: List<StoreMenu>): MatchResult? {
        val map = loadCache(context)
        val byId = products.associateBy { it.id }
        var best: MatchResult? = null
        for ((id, entry) in map) {
            val product = byId[id] ?: continue
            val score = ImageEmbedder.cosineSimilarity(photoEmbedding, entry.vector)
            if (best == null || score > best.similarity) best = MatchResult(product, score)
        }
        return best
    }

    private suspend fun fetchBitmap(context: Context, url: String): Bitmap? = withContext(Dispatchers.IO) {
        try {
            val request = ImageRequest.Builder(context)
                .data(url)
                // TFLite needs to read raw pixels; hardware bitmaps (Coil's default on API 26+)
                // don't allow that.
                .allowHardware(false)
                .build()
            val result = context.imageLoader.execute(request)
            (result as? SuccessResult)?.drawable?.let { (it as? BitmapDrawable)?.bitmap }
        } catch (e: Exception) {
            null
        }
    }
}
