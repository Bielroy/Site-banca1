// App Ponte da Banca: o celular Android que fica perto da impressora térmica e imprime os pedidos
// sozinho, mesmo com a tela bloqueada. Explicação completa: lib/ponte.js (servidor) e README.md desta pasta.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "PonteDaBanca"
include(":app")
