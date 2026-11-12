package com.smeag.mobilemart.data

import android.content.Context
import android.net.Uri
import com.jcraft.jsch.ChannelSftp
import com.jcraft.jsch.JSch
import com.jcraft.jsch.SftpException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * Uploads a product photo (taken with the camera or picked from the gallery on the Register
 * screen) to the SFTP server configured in [SftpConfig], so it's stored centrally instead of
 * only living as a local content:// / file:// Uri on the device that captured it.
 */
object SftpUploader {

    /**
     * Uploads the photo at [localUri] into the [SftpConfig.REMOTE_DIR] folder.
     *
     * Many SFTP-only accounts are chrooted straight into their target folder on login, in which
     * case [SftpConfig.REMOTE_DIR] doesn't exist as an absolute path *inside* the session (it
     * would resolve to `<remoteDir>/<remoteDir>` and fail with "No such file"). To handle both
     * layouts without needing to know which one this account uses, this tries, in order:
     *  1. `cd` into [SftpConfig.REMOTE_DIR] as given (works if the login lands at the real root).
     *  2. Create [SftpConfig.REMOTE_DIR] and `cd` into it, in case it simply doesn't exist yet.
     *  3. Fall back to the login's home directory as-is (works if the account is already
     *     chrooted into what [SftpConfig.REMOTE_DIR] refers to).
     *
     * @return the DB-storable relative path (e.g. `"mobilePicther/a1b2c3d4.jpg"`) to save into
     *   `store_menus.image_path`. Throws on any connection/auth/IO failure — the caller decides
     *   whether that should block product registration or just skip the photo.
     */
    suspend fun uploadProductPhoto(context: Context, localUri: Uri): String = withContext(Dispatchers.IO) {
        val extension = guessExtension(context, localUri)
        val remoteFileName = "${UUID.randomUUID()}.$extension"

        val jsch = JSch()
        val session = jsch.getSession(SftpConfig.USER, SftpConfig.HOST, SftpConfig.PORT)
        session.setPassword(SftpConfig.PASSWORD)
        // The server's host key isn't pinned anywhere in the project handoff, so strict
        // checking has nowhere to verify against. Same trust model as the direct MySQL
        // connection already used elsewhere in the app (see DbConfig's security note).
        session.setConfig("StrictHostKeyChecking", "no")

        try {
            session.connect(15_000)
            val channel = session.openChannel("sftp") as ChannelSftp
            try {
                channel.connect(15_000)
                enterRemoteDir(channel)
                context.contentResolver.openInputStream(localUri)?.use { input ->
                    channel.put(input, remoteFileName)
                } ?: throw IllegalStateException("Could not open the selected photo.")
            } finally {
                channel.disconnect()
            }
        } finally {
            session.disconnect()
        }

        // Stored the same way regardless of which branch enterRemoteDir() took, so it resolves
        // consistently via ImageConfig either way.
        "${SftpConfig.REMOTE_DIR_RELATIVE}/$remoteFileName"
    }

    /**
     * Tries to end up inside the intended upload folder regardless of whether the account's
     * SFTP root is the server's real filesystem root or is already chrooted into that folder.
     */
    private fun enterRemoteDir(channel: ChannelSftp) {
        val targetDir = SftpConfig.REMOTE_DIR
        try {
            channel.cd(targetDir)
            return
        } catch (e: SftpException) {
            // Fall through and try to create it.
        }
        try {
            channel.mkdir(targetDir)
            channel.cd(targetDir)
            return
        } catch (e: SftpException) {
            // Neither cd nor mkdir worked for the absolute path - assume the account is
            // already chrooted into the target folder and just stay in the login's home dir.
        }
    }

    private fun guessExtension(context: Context, uri: Uri): String {
        val type = context.contentResolver.getType(uri)
        return when {
            type?.contains("png") == true -> "png"
            type?.contains("webp") == true -> "webp"
            else -> "jpg"
        }
    }
}
