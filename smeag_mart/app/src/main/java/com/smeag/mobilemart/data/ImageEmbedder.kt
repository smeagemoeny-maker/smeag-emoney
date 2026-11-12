package com.smeag.mobilemart.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.support.common.ops.NormalizeOp
import org.tensorflow.lite.support.image.ImageProcessor
import org.tensorflow.lite.support.image.TensorImage
import org.tensorflow.lite.support.image.ops.ResizeOp
import org.tensorflow.lite.support.model.Model
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ln
import kotlin.math.sqrt

/**
 * ─── v7: Background-Suppressed Central 60% Attention Embedding ────────────────
 *
 * 사용자의 피드백을 반영하여 배경(주변 노이즈)의 영향을 극도로 억제하고
 * 중앙 60% 영역의 상품 이미지에만 강하게 집중하도록 설계되었습니다.
 *
 *   ┌────────────────────────────────┐
 *   │      Background 40% (10%)      │  외곽 40% 영역: 가중치 0.10 (배경 노이즈 90% 제거)
 *   │    ┌────────────────────┐      │
 *   │    │                    │      │
 *   │    │    Central 60%     │      │  중앙 60% 영역: 가중치 1.00 (100% 인식 반영)
 *   │    │      (100%)        │      │
 *   │    │                    │      │
 *   │    └────────────────────┘      │
 *   └────────────────────────────────┘
 *
 * - 중앙 60% 면적 (반경 비율 ≈ 0.775): 가중치 1.00 (100% 반영)
 * - 바깥 40% 면적 (배경): 가중치 0.10 (배경 무시, 10%만 반영)
 *
 * 이 가중치 분할은 뉴럴 크롭 가중합과 색상/형태(gradient) 히스토그램 모두에 적용되어,
 * 주변 배경이 어떻게 바뀌든 중앙에 놓인 상품 정보만으로 지문을 생성합니다.
 */
object ImageEmbedder {
    private const val MODEL_ASSET = "mobilenet_v2_feature_vector.tflite"
    private const val INPUT_SIZE  = 224

    // ── 영역 및 가중치 정의 ────────────────────────────────────────────────────
    // 중앙 60% 면적 비율 -> 반경 비율 √0.60 ≈ 0.775
    private const val CENTER_60_CROP = 0.775f

    private const val CENTER_WEIGHT = 1.00f       // 중앙 60% 영역 100% 반영
    private const val BACKGROUND_WEIGHT = 0.10f   // 배경 40% 영역은 10%만 반영 (90% 감쇄)

    // ── 기타 tunables ────────────────────────────────────────────────────────
    private const val TOP_K          = 15
    private const val HIST_BINS      = 48        // per quadrant: 16H + 16S + 16V
    private const val HIST_BINS3     = HIST_BINS / 3
    private const val QUADRANTS      = 4
    private const val COLOUR_DIMS    = HIST_BINS * QUADRANTS  // 192
    private const val GRAD_BINS      = 16
    private const val CRAFT_WEIGHT   = 0.45f
    private const val LOG_SCALE      = 100f

    @Volatile var embeddingSize: Int = 1001
        private set

    @Volatile private var interpreter: Interpreter? = null

    private fun getOrCreateInterpreter(context: Context): Interpreter {
        interpreter?.let { return it }
        synchronized(this) {
            interpreter?.let { return it }
            val model = Model.createModel(context.applicationContext, MODEL_ASSET)
            val created = Interpreter(model.data)
            embeddingSize = created.getOutputTensor(0).shape().last()
            interpreter = created
            return created
        }
    }

    fun isAvailable(context: Context): Boolean = try {
        getOrCreateInterpreter(context); true
    } catch (_: Exception) { false }

    /**
     * 중앙 60% 집중형 임베딩 생성:
     *   1. 중앙 위주의 크롭은 1.0 가중치, 배경이 포함된 전체/회전 크롭은 0.1 가중치를 부여해 합산
     *   2. 색상/엣지 히스토그램 연산 시 픽셀 좌표가 중앙 60%를 벗어나면 기여도를 10%로 감쇄
     */
    fun embed(context: Context, bitmap: Bitmap): FloatArray {
        val interp    = getOrCreateInterpreter(context)
        val processor = buildProcessor()

        data class WeightedCrop(val bitmap: Bitmap, val weight: Float)
        val crops = mutableListOf<WeightedCrop>()

        // 1. 중앙 집중 영역 (가중치 1.0)
        val z1 = centreCrop(bitmap, 0.45f)             // 중앙 코어 영역
        val z2 = centreCrop(bitmap, CENTER_60_CROP)   // 중앙 60% 면적 영역
        crops.add(WeightedCrop(z1, CENTER_WEIGHT))
        crops.add(WeightedCrop(horizontalFlip(z1), CENTER_WEIGHT))
        crops.add(WeightedCrop(z2, CENTER_WEIGHT))
        crops.add(WeightedCrop(horizontalFlip(z2), CENTER_WEIGHT))

        // 2. 주변 배경 포함 영역 (가중치 0.1)
        val z3 = bitmap                                // 전체 이미지
        val z4 = rotateCrop(bitmap, 5f)                // 약간 회전
        crops.add(WeightedCrop(z3, BACKGROUND_WEIGHT))
        crops.add(WeightedCrop(horizontalFlip(z3), BACKGROUND_WEIGHT))
        crops.add(WeightedCrop(z4, BACKGROUND_WEIGHT))
        crops.add(WeightedCrop(horizontalFlip(z4), BACKGROUND_WEIGHT))

        // ── 모델 추론 및 가중 합산 ───────────────────────────────────────────
        val accumulated = FloatArray(embeddingSize)
        for ((crop, weight) in crops) {
            val safe   = crop.copy(Bitmap.Config.ARGB_8888, false)
            val tensor = processor.process(TensorImage.fromBitmap(safe))
            val out    = Array(1) { FloatArray(embeddingSize) }
            interp.run(tensor.buffer, out)
            val v = out[0]

            // log(1 + 100·x) power normalisation
            for (i in v.indices) if (v[i] > 0f) v[i] = ln(1f + LOG_SCALE * v[i])

            // Zone 가중치 곱하여 누적
            for (i in accumulated.indices) accumulated[i] += v[i] * weight
        }

        // ── Top-K sparse masking ─────────────────────────────────────────────
        topKMask(accumulated, TOP_K)

        // ── 배경이 감쇄된 핸드크래프트 특징 추출 ─────────────────────────────────
        val colourHist = zoneSpatialColourHistogram(bitmap)   // 192 dims
        val gradHist   = zoneGradientHistogram(bitmap)        // 16 dims

        // ── 특징 융합 및 L2 정규화 ─────────────────────────────────────────────
        val craftDims = COLOUR_DIMS + GRAD_BINS  // 208
        val fused = FloatArray(embeddingSize + craftDims)
        for (i in accumulated.indices) fused[i] = accumulated[i]
        for (i in colourHist.indices)  fused[embeddingSize + i] = colourHist[i] * CRAFT_WEIGHT
        for (i in gradHist.indices)    fused[embeddingSize + COLOUR_DIMS + i] = gradHist[i] * CRAFT_WEIGHT

        return l2Normalize(fused)
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  영역 판별 및 가중치 계산
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * 이미지 중심에서의 정규화된 거리를 계산하여 중앙 60% 영역 내이면 1.0, 외곽이면 0.1 가중치를 리턴합니다.
     */
    private fun zoneWeight(px: Int, py: Int, w: Int, h: Int): Float {
        val cx = w / 2f
        val cy = h / 2f
        val nx = (px - cx) / cx
        val ny = (py - cy) / cy
        val dist = sqrt(nx * nx + ny * ny)

        return if (dist <= CENTER_60_CROP) CENTER_WEIGHT else BACKGROUND_WEIGHT
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  영역 가중 특징 추출
    // ══════════════════════════════════════════════════════════════════════════

    private fun zoneSpatialColourHistogram(src: Bitmap): FloatArray {
        val thumb = Bitmap.createScaledBitmap(src, 64, 64, true)
        val tw = thumb.width; val th = thumb.height
        val pixels = IntArray(tw * th)
        thumb.getPixels(pixels, 0, tw, 0, 0, tw, th)

        val result = FloatArray(COLOUR_DIMS)
        val quadTotals = FloatArray(QUADRANTS)
        val hsv = FloatArray(3)

        for (py in 0 until th) {
            for (px in 0 until tw) {
                val w = zoneWeight(px, py, tw, th)

                val qx = if (px < tw / 2) 0 else 1
                val qy = if (py < th / 2) 0 else 1
                val q  = qy * 2 + qx
                val offset = q * HIST_BINS

                Color.colorToHSV(pixels[py * tw + px], hsv)
                val hi = ((hsv[0] / 360f) * HIST_BINS3).toInt().coerceIn(0, HIST_BINS3 - 1)
                val si = (hsv[1] * HIST_BINS3).toInt().coerceIn(0, HIST_BINS3 - 1)
                val vi = (hsv[2] * HIST_BINS3).toInt().coerceIn(0, HIST_BINS3 - 1)

                result[offset + hi]              += w
                result[offset + HIST_BINS3 + si]  += w
                result[offset + 2 * HIST_BINS3 + vi] += w
                quadTotals[q] += w
            }
        }

        for (q in 0 until QUADRANTS) {
            val total = quadTotals[q].coerceAtLeast(1f)
            val offset = q * HIST_BINS
            for (i in 0 until HIST_BINS) result[offset + i] /= total
        }
        return result
    }

    private fun zoneGradientHistogram(src: Bitmap): FloatArray {
        val thumb = Bitmap.createScaledBitmap(src, 64, 64, true)
        val tw = thumb.width; val th = thumb.height
        val pixels = IntArray(tw * th)
        thumb.getPixels(pixels, 0, tw, 0, 0, tw, th)

        val grey = FloatArray(tw * th)
        for (i in pixels.indices) {
            val r = Color.red(pixels[i])
            val g = Color.green(pixels[i])
            val b = Color.blue(pixels[i])
            grey[i] = (0.299f * r + 0.587f * g + 0.114f * b) / 255f
        }

        val bins = FloatArray(GRAD_BINS)
        var totalMag = 0f

        for (y in 1 until th - 1) {
            for (x in 1 until tw - 1) {
                val gx = grey[y * tw + x + 1] - grey[y * tw + x - 1]
                val gy = grey[(y + 1) * tw + x] - grey[(y - 1) * tw + x]
                val mag = sqrt(gx * gx + gy * gy)
                if (mag < 1e-6f) continue

                var angle = atan2(gy, gx)
                if (angle < 0f) angle += Math.PI.toFloat()
                val bin = ((angle / Math.PI.toFloat()) * GRAD_BINS).toInt()
                    .coerceIn(0, GRAD_BINS - 1)

                val w = zoneWeight(x, y, tw, th)
                val weightedMag = mag * w
                bins[bin] += weightedMag
                totalMag += weightedMag
            }
        }

        if (totalMag > 0f) for (i in bins.indices) bins[i] /= totalMag
        return bins
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Helper Math & Utility
    // ══════════════════════════════════════════════════════════════════════════

    private fun buildProcessor(): ImageProcessor =
        ImageProcessor.Builder()
            .add(ResizeOp(INPUT_SIZE, INPUT_SIZE, ResizeOp.ResizeMethod.BILINEAR))
            .add(NormalizeOp(127.5f, 127.5f))
            .build()

    private fun centreCrop(src: Bitmap, fraction: Float): Bitmap {
        val w = (src.width  * fraction).toInt().coerceAtLeast(1)
        val h = (src.height * fraction).toInt().coerceAtLeast(1)
        val x = (src.width  - w) / 2
        val y = (src.height - h) / 2
        return Bitmap.createBitmap(src, x, y, w, h)
    }

    private fun horizontalFlip(src: Bitmap): Bitmap {
        val m = Matrix().apply { preScale(-1f, 1f) }
        return Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, false)
    }

    private fun rotateCrop(src: Bitmap, degrees: Float): Bitmap {
        val m = Matrix().apply { postRotate(degrees, src.width / 2f, src.height / 2f) }
        return Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
    }

    private fun topKMask(v: FloatArray, k: Int) {
        if (k >= v.size) return
        val sorted = v.clone(); sorted.sort()
        val threshold = sorted[v.size - k]
        for (i in v.indices) if (v[i] < threshold) v[i] = 0f
    }

    private fun l2Normalize(v: FloatArray): FloatArray {
        var n = 0f; for (x in v) n += x * x; n = sqrt(n)
        if (n > 0f) for (i in v.indices) v[i] /= n
        return v
    }

    fun cosineSimilarity(a: FloatArray, b: FloatArray): Float {
        if (a.size != b.size) return -1f
        var dot = 0f; var nA = 0f; var nB = 0f
        for (i in a.indices) { dot += a[i]*b[i]; nA += a[i]*a[i]; nB += b[i]*b[i] }
        val d = sqrt(nA) * sqrt(nB)
        return if (d == 0f) 0f else dot / d
    }
}
