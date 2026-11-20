package com.usebanca.ponte

import android.annotation.SuppressLint
import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * ÁREA DO DONO: pedir tarefas ao bot do servidor (lib/bot.js, api/bot.js) com a digital.
 *  - Só abre com a trava do celular (digital, rosto ou senha). Celular sem trava não entra.
 *  - Liga com o código que o dono da plataforma gera na Plataforma → Chaves → "Área do dono no app da ponte".
 *  - Tarefa sensível pede a digital de novo, a não ser no "modo automático" (1 hora, desliga sozinho).
 *  - Tela protegida contra captura (FLAG_SECURE). O token fica só neste celular, sem backup.
 * A parte da impressora continua na tela principal, sem trava nenhuma.
 */
@SuppressLint("SetTextI18n")
class DonoActivity : Activity() {

    private val p by lazy { getSharedPreferences("dono", Context.MODE_PRIVATE) }
    private val servidor by lazy { Config(this).servidor.trimEnd('/') }
    private var token: String
        get() = p.getString("token", "") ?: ""
        set(v) { p.edit().putString("token", v).apply() }
    private var autoAte: Long
        get() = p.getLong("autoAte", 0L)
        set(v) { p.edit().putLong("autoAte", v).apply() }

    private lateinit var coluna: LinearLayout
    private var destravada = false
    private var autenticando = false
    private var aoConfirmarSenha: ((Boolean) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        window.statusBarColor = VERDE
        coluna = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(16), dp(16), dp(32)) }
        setContentView(ScrollView(this).apply { setBackgroundColor(FUNDO); isFillViewport = true; addView(coluna) })
        val km = getSystemService(KeyguardManager::class.java)
        if (km == null || !km.isDeviceSecure) {
            mostrarAviso("Este celular não tem trava de tela.", "Para usar a área do dono, ponha digital, rosto ou senha no celular (Configurações → Segurança) e abra de novo.")
            return
        }
        autenticar("Abrir a área do dono") { ok -> if (ok) { destravada = true; montar() } else finish() }
    }

    override fun onStop() {
        super.onStop()
        // saiu da tela: na volta, pede a digital de novo
        if (destravada && !autenticando && !isChangingConfigurations) finish()
    }

    // ------------------------------------------------------------ digital / senha do celular
    private fun autenticar(motivo: String, aoTerminar: (Boolean) -> Unit) {
        autenticando = true
        val depois: (Boolean) -> Unit = { ok -> autenticando = false; aoTerminar(ok) }
        if (Build.VERSION.SDK_INT >= 28) {
            val b = BiometricPrompt.Builder(this).setTitle("Área do dono").setDescription(motivo)
            when {
                Build.VERSION.SDK_INT >= 30 -> b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                Build.VERSION.SDK_INT >= 29 -> @Suppress("DEPRECATION") b.setDeviceCredentialAllowed(true)
                else -> b.setNegativeButton("Cancelar", mainExecutor) { _, _ -> depois(false) }
            }
            try {
                b.build().authenticate(CancellationSignal(), mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) { depois(true) }
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) { depois(false) }
                })
                return
            } catch (_: Exception) { /* sem digital cadastrada no Android 9: cai na senha do celular */ }
        }
        val km = getSystemService(KeyguardManager::class.java)
        @Suppress("DEPRECATION")
        val i = km?.createConfirmDeviceCredentialIntent("Área do dono", motivo)
        if (i == null) { depois(false); return }
        aoConfirmarSenha = depois
        @Suppress("DEPRECATION")
        startActivityForResult(i, PEDIDO_SENHA)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == PEDIDO_SENHA) { val f = aoConfirmarSenha; aoConfirmarSenha = null; f?.invoke(resultCode == RESULT_OK) }
    }

    // ------------------------------------------------------------ telas
    private fun montar() {
        coluna.removeAllViews()
        coluna.addView(texto("Área do dono", 26f, true, VERDE))
        coluna.addView(texto("Pedidos ao servidor da loja. Só a conta dona da plataforma liga um celular aqui.", 15f, false, SUAVE))
        if (token.isEmpty()) montarLigar() else montarTarefas()
    }

    private fun montarLigar() {
        val c = cartao("Ligar este celular")
        c.addView(texto("Na Plataforma (painel), aba Chaves → \"Área do dono no app da ponte\" → \"Gerar código\". Digite aqui o código.", 15f, false, SUAVE))
        val campo = EditText(this).apply {
            hint = "Código de 8 letras"; textSize = 18f; setSingleLine(); gravity = Gravity.CENTER; letterSpacing = 0.15f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            filters = arrayOf(InputFilter.LengthFilter(12), InputFilter.AllCaps())
            background = fundo(Color.WHITE, BORDA, 12); setPadding(dp(14), dp(12), dp(14), dp(12))
            layoutParams = largura().apply { topMargin = dp(10) }
        }
        c.addView(campo)
        c.addView(botao("Ligar") { b ->
            b.isEnabled = false
            chamar(JSONObject().put("op", "entrar").put("codigo", campo.text.toString()).put("app", JSONObject().put("modelo", "${Build.MANUFACTURER} ${Build.MODEL}".trim())), comToken = false,
                ok = { j -> token = j.optString("token"); aviso("Celular ligado à área do dono."); montar() },
                erro = { b.isEnabled = true })
        })
        coluna.addView(c)
    }

    private fun montarTarefas() {
        val auto = cartao(null)
        val ligado = autoAte > System.currentTimeMillis()
        auto.addView(texto(if (ligado) "Modo automático ligado até ${hora(autoAte)}" else "Modo automático desligado", 17f, true, if (ligado) ALERTA else VERDE))
        auto.addView(texto(if (ligado) "As tarefas sensíveis não pedem a digital de novo até lá." else "Ligado, as tarefas sensíveis não pedem a digital por 1 hora (desliga sozinho).", 14f, false, SUAVE))
        auto.addView(botao(if (ligado) "Desligar agora" else "Ligar por 1 hora", cheio = false) {
            if (ligado) { autoAte = 0; montar() } else autenticar("Ligar o modo automático por 1 hora") { ok -> if (ok) { autoAte = System.currentTimeMillis() + 3600_000; montar() } }
        })
        coluna.addView(auto)

        val normais = cartao("Tarefas")
        listOf("estado" to "Ver o estado do servidor", "atualizar" to "Atualizar o servidor", "reiniciar" to "Reiniciar o servidor",
            "copia-agora" to "Fazer a cópia do banco agora", "ligar-copia" to "Ligar a cópia diária").forEach { (t, rot) ->
            normais.addView(botao(rot) { b -> pedir(t, false, b) })
        }
        coluna.addView(normais)

        val sens = cartao("Sensíveis (pedem a digital)")
        listOf("limpar-historico" to "Limpar o histórico do terminal", "limpar-disco" to "Limpar o disco (imagens velhas)").forEach { (t, rot) ->
            sens.addView(botao("🔒 $rot", cheio = false) { b -> pedir(t, true, b) })
        }
        sens.addView(texto("Trocar uma chave do servidor continua pelo GitHub (Tarefas do servidor → trocar-segredo).", 13f, false, SUAVE))
        coluna.addView(sens)

        val ult = cartao("Últimas tarefas")
        val lista = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        lista.addView(texto("Carregando...", 14f, false, SUAVE))
        ult.addView(lista)
        ult.addView(botao("Atualizar a lista", cheio = false) { carregarUltimas(lista) })
        coluna.addView(ult)
        carregarUltimas(lista)

        coluna.addView(botao("Tirar este celular da área do dono", cheio = false) { b ->
            autenticar("Tirar este celular da área do dono") { ok ->
                if (!ok) return@autenticar
                b.isEnabled = false
                chamar(JSONObject().put("op", "sair"), ok = { token = ""; autoAte = 0; aviso("Celular desligado da área do dono."); montar() }, erro = { b.isEnabled = true })
            }
        })
    }

    private fun pedir(tarefa: String, sensivel: Boolean, b: Button) {
        val enviar = {
            b.isEnabled = false
            val antes = b.text
            b.text = if (sensivel) "Pedindo e aprovando..." else "Pedindo..."
            chamar(JSONObject().put("op", "tarefa").put("tarefa", tarefa), esperaMs = 70000,
                ok = { j ->
                    b.isEnabled = true; b.text = antes
                    aviso(when {
                        !j.optBoolean("encontrado", true) -> "Pedido feito. O GitHub ainda não mostrou o trabalho; veja em Últimas tarefas."
                        sensivel && !j.optBoolean("aprovada") -> "Pedido feito, mas não consegui aprovar. Aprove no app do GitHub."
                        else -> "Pedido feito. Acompanhe em Últimas tarefas."
                    })
                    principal { coluna.findViewWithTag<LinearLayout>("ultimas")?.let { carregarUltimas(it) } }
                },
                erro = { b.isEnabled = true; b.text = antes })
        }
        if (sensivel && autoAte <= System.currentTimeMillis()) autenticar("Confirmar: ${b.text.toString().removePrefix("🔒 ")}") { ok -> if (ok) enviar() }
        else enviar()
    }

    private fun carregarUltimas(lista: LinearLayout) {
        lista.tag = "ultimas"
        chamar(JSONObject().put("op", "cardapio"), ok = { j ->
            lista.removeAllViews()
            val aviso = j.optString("aviso")
            if (aviso.isNotEmpty()) lista.addView(texto(aviso, 14f, false, ERRO))
            val u: JSONArray = j.optJSONArray("ultimas") ?: JSONArray()
            if (u.length() == 0 && aviso.isEmpty()) lista.addView(texto("Nenhuma tarefa ainda.", 14f, false, SUAVE))
            for (i in 0 until u.length()) {
                val x = u.getJSONObject(i)
                val sit = x.optString("situacao")
                val linha = texto("${quando(x.optString("em"))} · ${x.optString("titulo")} — $sit", 15f, false,
                    when (sit) { "ok" -> VERDE; "falhou" -> ERRO; "esperando aprovação" -> ALERTA; else -> TEXTO })
                val link = x.optString("link")
                if (link.startsWith("https://github.com/")) linha.setOnClickListener { try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link))) } catch (_: Exception) { } }
                lista.addView(linha)
            }
        }, erro = { })
    }

    private fun mostrarAviso(titulo: String, msg: String) {
        coluna.removeAllViews()
        coluna.addView(texto(titulo, 22f, true, ERRO))
        coluna.addView(texto(msg, 16f))
        coluna.addView(botao("Voltar") { finish() })
    }

    // ------------------------------------------------------------ conversa com a loja (POST /api/bot)
    private fun chamar(corpo: JSONObject, comToken: Boolean = true, esperaMs: Int = 20000, ok: (JSONObject) -> Unit, erro: () -> Unit) {
        Thread {
            try {
                val c = URL("$servidor/api/bot").openConnection() as HttpURLConnection
                c.requestMethod = "POST"; c.doOutput = true; c.useCaches = false
                c.connectTimeout = 15000; c.readTimeout = esperaMs
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                c.setRequestProperty("Accept", "application/json")
                c.setRequestProperty("User-Agent", "PonteDaBanca/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})")
                if (comToken) c.setRequestProperty("Authorization", "Bearer $token")
                val dados = corpo.toString().toByteArray(Charsets.UTF_8)
                c.setFixedLengthStreamingMode(dados.size)
                c.outputStream.use { it.write(dados) }
                val codigo = c.responseCode
                val txt = (if (codigo in 200..299) c.inputStream else c.errorStream)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
                val j = try { JSONObject(txt) } catch (_: Exception) { JSONObject() }
                principal {
                    if (codigo in 200..299) ok(j)
                    else {
                        if (codigo == 401 && comToken) { token = ""; autoAte = 0 }
                        aviso(j.optString("error").ifEmpty { "A loja respondeu com erro $codigo." })
                        erro()
                        if (codigo == 401 && comToken) montar()
                    }
                }
            } catch (_: Exception) {
                principal { aviso("Sem conexão com a loja. Confira a internet e tente de novo."); erro() }
            }
        }.start()
    }

    // ------------------------------------------------------------ desenho (o mesmo jeito da tela principal)
    private fun principal(f: () -> Unit) = runOnUiThread { if (!isFinishing) f() }
    private fun aviso(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun largura() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun fundo(cor: Int, borda: Int, raio: Int = 14) = GradientDrawable().apply { setColor(cor); cornerRadius = dp(raio).toFloat(); setStroke(dp(2), borda) }
    private fun texto(t: String, tam: Float = 16f, negrito: Boolean = false, cor: Int = TEXTO) = TextView(this).apply {
        text = t; textSize = tam; setTextColor(cor); setLineSpacing(0f, 1.15f)
        if (negrito) setTypeface(typeface, Typeface.BOLD)
        layoutParams = largura().apply { topMargin = dp(6) }
    }
    private fun botao(t: String, cheio: Boolean = true, acao: (Button) -> Unit): Button = Button(this).apply {
        text = t; isAllCaps = false; textSize = 16f; minHeight = dp(52)
        setTextColor(if (cheio) Color.WHITE else VERDE)
        background = fundo(if (cheio) VERDE else Color.WHITE, VERDE)
        setPadding(dp(16), dp(10), dp(16), dp(10))
        setOnClickListener { acao(this) }
        layoutParams = largura().apply { topMargin = dp(10) }
    }
    private fun cartao(titulo: String?) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = fundo(Color.WHITE, BORDA)
        setPadding(dp(16), dp(14), dp(16), dp(16))
        layoutParams = largura().apply { topMargin = dp(14) }
        if (titulo != null) addView(texto(titulo, 18f, true, VERDE))
    }
    private fun hora(ms: Long) = SimpleDateFormat("HH:mm", Locale("pt", "BR")).format(ms)
    private fun quando(iso: String): String = try {
        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        SimpleDateFormat("dd/MM HH:mm", Locale("pt", "BR")).format(f.parse(iso)!!)
    } catch (_: Exception) { "" }

    companion object {
        private const val PEDIDO_SENHA = 77
        private val VERDE = Color.rgb(0x1a, 0x3a, 0x2a)
        private val FUNDO = Color.rgb(0xf6, 0xf1, 0xe4)
        private val BORDA = Color.rgb(0xe0, 0xdc, 0xd4)
        private val TEXTO = Color.rgb(0x22, 0x22, 0x22)
        private val SUAVE = Color.rgb(0x5a, 0x5a, 0x55)
        private val ERRO = Color.rgb(0xb3, 0x26, 0x1e)
        private val ALERTA = Color.rgb(0x8a, 0x53, 0x00)
    }
}
