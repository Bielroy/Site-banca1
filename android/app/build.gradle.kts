// Sem nenhuma biblioteca de fora: só o Android e o Kotlin. APK pequeno e nada para atualizar.
// O GitHub (.github/workflows/app-ponte.yml) compila e assina com a chave guardada nos segredos do repositório.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val numero = (System.getenv("VERSAO_NUMERO") ?: "1").toIntOrNull() ?: 1
val arquivoChave = System.getenv("ASSINATURA_ARQUIVO")

android {
    namespace = "com.usebanca.ponte"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.usebanca.ponte"
        minSdk = 24
        targetSdk = 34
        versionCode = numero
        versionName = "1.0.$numero"
    }

    signingConfigs {
        create("banca") {
            if (arquivoChave != null) {
                storeFile = file(arquivoChave)
                storePassword = System.getenv("ASSINATURA_SENHA")
                keyAlias = "ponte"
                keyPassword = System.getenv("ASSINATURA_SENHA")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (arquivoChave != null) signingConfigs.getByName("banca") else signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}
