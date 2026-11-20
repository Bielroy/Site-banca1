package com.usebanca.ponte

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Tudo o que o app guarda. Fica só neste celular, na área privada do app
 * (o backup do Android está desligado no manifesto: o token não vai para a nuvem).
 */
class Config(contexto: Context) {
    private val p = contexto.applicationContext.getSharedPreferences("ponte", Context.MODE_PRIVATE)

    private fun texto(k: String, padrao: String = "") = p.getString(k, null) ?: padrao
    private fun gravar(k: String, v: String) = p.edit().putString(k, v).apply()

    /** Endereço da loja (o mesmo do painel). */
    var servidor: String
        get() = texto("servidor", SERVIDOR_PADRAO)
        set(v) = gravar("servidor", v)

    /** Token deste celular (dado pela loja quando o código do painel foi digitado). */
    var token: String
        get() = texto("token")
        set(v) = gravar("token", v)

    var loja: String
        get() = texto("loja")
        set(v) = gravar("loja", v)

    /** A pessoa pode desligar a ponte pelo app sem desfazer a ligação com a loja. */
    var ligada: Boolean
        get() = p.getBoolean("ligada", true)
        set(v) = p.edit().putBoolean("ligada", v).apply()

    var impressoraEndereco: String
        get() = texto("impEndereco")
        set(v) = gravar("impEndereco", v)

    var impressoraNome: String
        get() = texto("impNome")
        set(v) = gravar("impNome", v)

    /** Como a impressora respondeu da última vez: "" (ainda não sabe), "spp" (clássico) ou "ble". */
    var conexao: String
        get() = texto("conexao")
        set(v) = gravar("conexao", v)

    /** Papel e acentos (vêm do painel; usados no teste feito pelo app). */
    var largura: Int
        get() = p.getInt("largura", 80)
        set(v) = p.edit().putInt("largura", v).apply()

    var acentos: Boolean
        get() = p.getBoolean("acentos", false)
        set(v) = p.edit().putBoolean("acentos", v).apply()

    /** Horário de ligar e de desligar ("HH:MM", vêm do painel). Vazios = sempre ligada. */
    var ligarAs: String
        get() = texto("ligarAs")
        set(v) = gravar("ligarAs", v)

    var desligarAs: String
        get() = texto("desligarAs")
        set(v) = gravar("desligarAs", v)

    /** Ligada à mão fora do horário: vale até esta hora (ms do relógio). */
    var forcarAte: Long
        get() = p.getLong("forcarAte", 0L)
        set(v) = p.edit().putLong("forcarAte", v).apply()

    /** Mensagem para mostrar quando o painel desligou este celular. */
    var avisoDesligado: String
        get() = texto("avisoDesligado")
        set(v) = gravar("avisoDesligado", v)

    val pareado: Boolean get() = token.isNotEmpty()

    fun desparear() {
        p.edit().remove("token").remove("loja").remove("feitos").remove("impressos").apply()
    }

    // ------------------------------------------------------------ o que já saiu no papel
    // Se a confirmação se perder no caminho, a loja manda o mesmo papel de novo:
    // aqui o app lembra que já imprimiu e só confirma, sem gastar papel.
    @Synchronized
    fun jaImpresso(chave: String): Boolean = objeto("impressos").has(chave)

    @Synchronized
    fun marcarImpresso(chave: String) {
        val o = objeto("impressos")
        val agora = System.currentTimeMillis()
        o.put(chave, agora)
        val velhos = mutableListOf<String>()
        val nomes = o.keys()
        while (nomes.hasNext()) {
            val k = nomes.next()
            if (agora - o.optLong(k) > GUARDAR_IMPRESSOS_MS) velhos.add(k)
        }
        velhos.forEach { o.remove(it) }
        gravar("impressos", o.toString())
    }

    // ------------------------------------------------------------ o que falta contar à loja
    @Synchronized
    fun feitos(): JSONArray = try { JSONArray(texto("feitos", "[]")) } catch (_: Exception) { JSONArray() }

    @Synchronized
    fun addFeito(chave: String, ok: Boolean, msg: String?) {
        val atual = feitos()
        val novo = JSONArray()
        for (i in 0 until atual.length()) {
            val f = atual.optJSONObject(i) ?: continue
            if (f.optString("chave") != chave) novo.put(f)
        }
        val f = JSONObject().put("chave", chave).put("ok", ok)
        if (msg != null) f.put("msg", msg.take(160))
        novo.put(f)
        while (novo.length() > 30) novo.remove(0)
        gravar("feitos", novo.toString())
    }

    /** A loja recebeu estes: tira da lista (o que entrou depois continua). */
    @Synchronized
    fun tirarFeitos(enviados: JSONArray) {
        val ja = HashMap<String, Boolean>()
        for (i in 0 until enviados.length()) enviados.optJSONObject(i)?.let { ja[it.optString("chave")] = it.optBoolean("ok") }
        val atual = feitos()
        val novo = JSONArray()
        for (i in 0 until atual.length()) {
            val f = atual.optJSONObject(i) ?: continue
            val k = f.optString("chave")
            if (!ja.containsKey(k) || ja[k] != f.optBoolean("ok")) novo.put(f)
        }
        gravar("feitos", novo.toString())
    }

    private fun objeto(k: String): JSONObject = try { JSONObject(texto(k, "{}")) } catch (_: Exception) { JSONObject() }

    companion object {
        const val SERVIDOR_PADRAO = "https://usebanca.com"
        private const val GUARDAR_IMPRESSOS_MS = 12L * 60 * 60 * 1000
    }
}
