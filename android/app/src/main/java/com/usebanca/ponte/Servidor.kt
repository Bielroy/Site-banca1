package com.usebanca.ponte

import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Conversa com a loja (POST /api/ponte). Só o que vem no Android: nada de biblioteca de fora.
 * A conexão é reaproveitada entre uma chamada e outra (menos rádio ligado, menos bateria).
 */
class Servidor(private val cfg: Config) {
    class Erro(val codigo: Int, mensagem: String, val desligado: Boolean) : Exception(mensagem)

    @Volatile
    private var atual: HttpURLConnection? = null

    /** Larga a conversa em andamento (rede trocou, app desligando). */
    fun cancelar() {
        try { atual?.disconnect() } catch (_: Exception) { }
    }

    /**
     * Manda `corpo` e devolve a resposta. `aoEnviar` roda depois que o pedido saiu e antes de
     * esperar a resposta (o serviço solta a trava de "acordado" ali: esperando, o celular pode dormir).
     */
    fun chamar(corpo: JSONObject, autenticar: Boolean = true, esperaMs: Int = 20000, aoEnviar: (() -> Unit)? = null): JSONObject {
        val c = URL(cfg.servidor.trimEnd('/') + "/api/ponte").openConnection() as HttpURLConnection
        atual = c
        try {
            c.requestMethod = "POST"
            c.doOutput = true
            c.useCaches = false
            c.connectTimeout = 15000
            c.readTimeout = esperaMs
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            c.setRequestProperty("Accept", "application/json")
            c.setRequestProperty("User-Agent", "PonteDaBanca/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})")
            if (autenticar) c.setRequestProperty("Authorization", "Bearer " + cfg.token)
            val dados = corpo.toString().toByteArray(Charsets.UTF_8)
            c.setFixedLengthStreamingMode(dados.size)
            c.outputStream.use { it.write(dados) }
            aoEnviar?.invoke()
            val codigo = c.responseCode
            val fluxo = if (codigo in 200..299) c.inputStream else c.errorStream
            val texto = fluxo?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            val json = try { JSONObject(texto) } catch (_: Exception) { JSONObject() }
            if (codigo !in 200..299) {
                val msg = json.optString("error").ifEmpty { "a loja respondeu com erro $codigo" }
                throw Erro(codigo, msg, codigo == 401 || json.optBoolean("desligado", false))
            }
            return json
        } finally {
            atual = null
        }
    }
}
