plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.smeag.mobilemart"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.smeag.mobilemart"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
        // The TFLite interpreter memory-maps the model file directly out of the APK;
        // if AAPT compresses it, that mapping fails at runtime ("Unable to mmap").
        jniLibs { useLegacyPackaging = false }
    }
    androidResources {
        noCompress += "tflite"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")

    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")

    // Camera (product photo capture)
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")

    // MySQL direct connection (matches existing SMEAG DB - see README for security notes)
    implementation("org.mariadb.jdbc:mariadb-java-client:3.4.1")

    // SFTP upload for product photos (see SftpConfig / SftpUploader). Using the mwiede fork
    // instead of the original com.jcraft:jsch, since it stays compatible with modern SSH
    // servers (newer key exchange/cipher algorithms) while keeping the same com.jcraft.jsch
    // package name, so no source changes are needed if you ever swap it back.
    implementation("com.github.mwiede:jsch:0.2.17")

    // Coil for loading product images
    implementation("io.coil-kt:coil-compose:2.6.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // On-device image similarity search (Sales screen "find by photo" feature).
    // Interpreter runs the MobileNetV2 feature-vector model downloaded by
    // downloadProductMatchModel (see app/download_model.gradle) into assets/.
    implementation("org.tensorflow:tensorflow-lite:2.14.0")
    implementation("org.tensorflow:tensorflow-lite-support:0.4.4")

    debugImplementation("androidx.compose.ui:ui-tooling")
}

// Downloads the MobileNetV2 feature-vector TFLite model used by the Sales screen's
// "find by photo" feature into src/main/assets/ before every build, the same pattern
// TensorFlow's own official example apps use for their model assets. See that file for
// details, including what to do if this network fetch isn't reachable during your build
// (e.g. behind a restrictive proxy) — you can drop the .tflite file in manually instead.
apply(from = "download_model.gradle")
