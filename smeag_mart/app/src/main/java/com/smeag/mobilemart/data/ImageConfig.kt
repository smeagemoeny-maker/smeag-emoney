package com.smeag.mobilemart.data

/**
 * `store_menus.image_path` in the DB stores relative paths like
 * `"ProductImg/Product.jpg"` — that's how the original C# desktop client
 * read them, from a local image folder next to the program.
 *
 * The Register screen now uploads new photos via SFTP to `/mobilePicther/`
 * on this same host (see [SftpConfig] / [SftpUploader]) and stores a path
 * like `"mobilePicther/<uuid>.jpg"` here. [BASE_URL] below assumes an HTTP
 * file server also exposes that same folder for *reading* images back —
 * SFTP only gets the file onto the server, something still has to serve it
 * over HTTP for Coil/AsyncImage to load it as a thumbnail. If thumbnails
 * don't load after a successful upload, that HTTP exposure is what's
 * missing; check with whoever manages the server.
 */

object ImageConfig {
    // Not `const` — const val requires a compile-time-constant initializer,
    // and a string template referencing another const val doesn't qualify
    // (this was a real compile error: "Const 'val' initializer should be
    // a constant value"). A plain `val` works exactly the same at runtime.
    val BASE_URL = "http://${DbConfig.HOST}/"

    /** Turns a DB-stored path into something Coil's AsyncImage can load, or null if there's nothing to show. */
    fun resolve(imagePath: String?): String? {
        if (imagePath.isNullOrBlank()) return null
        return when {
            imagePath.startsWith("http://") || imagePath.startsWith("https://") -> imagePath
            imagePath.startsWith("content://") || imagePath.startsWith("file://") -> imagePath
            else -> BASE_URL.trimEnd('/') + "/" + imagePath.trimStart('/')
        }
    }
}
