package com.usebanca.ponte

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A única tela do app. Três passos, de cima para baixo:
 *   1. escolher a impressora (e imprimir um teste);
 *   2. ligar à loja com o código do painel;
 *   3. deixar sempre ligada (permissões e bateria).
 * Em cima, o estado: "Pronta para imprimir", "Sem internet", "Impressora não responde"...
 */
@SuppressLint("MissingPermission", "SetTextI18n")
class MainActivity : Activity() {

    private lateinit var cfg: Config
    private val principal = Handler(Looper.getMainLooper())

    private lateinit var txtEstado: TextView
    private lateinit var txtDetalhe: TextView
    private lateinit var btnLigar: Button
    private lateinit var txtImpressora: TextView
    private lateinit var caixaParear: LinearLayout
    private lateinit var caixaLigada: LinearLayout
    private lateinit var txtLoja: TextView
    private lateinit var campoCodigo: EditText
    private lateinit var campoServidor: EditText
    private lateinit var btnEntrar: Button
    private lateinit var listaChecks: LinearLayout
    private var assinaturaChecks = ""
    private var depoisDaPermissao: (() -> Unit)? = null

    private val atualizador = object : Runnable {
        override fun run() { atualizar(); principal.postDelayed(this, 2000) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cfg = Config(this)
        window.statusBarColor = VERDE
        setContentView(montar())
        tratarLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        tratarLink(intent)
    }

    override fun onResume() {
        super.onResume()
        principal.removeCallbacks(atualizador)
        principal.post(atualizador)
        if (cfg.pareado && cfg.ligada && PonteService.instancia == null && Horario.podeRodar(cfg)) PonteService.iniciar(this)
    }

    override fun onPause() {
        super.onPause()
        principal.removeCallbacks(atualizador)
    }

    // ------------------------------------------------------------ montagem da tela
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun fundo(cor: Int, borda: Int, raio: Int = 14): GradientDrawable = GradientDrawable().apply {
        setColor(cor); cornerRadius = dp(raio).toFloat(); setStroke(dp(2), borda)
    }

    private fun texto(t: String, tam: Float = 16f, negrito: Boolean = false, cor: Int = TEXTO): TextView = TextView(this).apply {
        text = t
        textSize = tam
        setTextColor(cor)
        if (negrito) setTypeface(typeface, Typeface.BOLD)
        setLineSpacing(0f, 1.15f)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) }
    }

    private fun botao(t: String, cheio: Boolean = true, acao: () -> Unit): Button = Button(this).apply {
        text = t
        isAllCaps = false
        textSize = 16f
        setTextColor(if (cheio) Color.WHITE else VERDE)
        background = fundo(if (cheio) VERDE else Color.WHITE, VERDE)
        minHeight = dp(52)
        setPadding(dp(16), dp(10), dp(16), dp(10))
        setOnClickListener { acao() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) }
    }

    private fun cartao(titulo: String?): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = fundo(Color.WHITE, BORDA)
        setPadding(dp(16), dp(14), dp(16), dp(16))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14) }
        if (titulo != null) addView(texto(titulo, 18f, true, VERDE))
    }

    private fun campo(dica: String): EditText = EditText(this).apply {
        hint = dica
        textSize = 18f
        setSingleLine()
        background = fundo(Color.WHITE, BORDA, 12)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) }
    }

    private fun montar(): View {
        val coluna = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(32))
        }
        coluna.addView(texto("Ponte da Banca", 26f, true, VERDE))
        coluna.addView(texto("Este celular imprime os pedidos da loja na impressora térmica, mesmo com a tela bloqueada.", 15f, false, TEXTO_SUAVE))

        // estado
        val estado = cartao(null)
        txtEstado = texto("", 20f, true, VERDE)
        txtDetalhe = texto("", 15f, false, TEXTO_SUAVE)
        btnLigar = botao("Desligar a ponte", false) { alternarLigada() }
        estado.addView(txtEstado); estado.addView(txtDetalhe); estado.addView(btnLigar)
        coluna.addView(estado)

        // 1. impressora
        val imp = cartao("1. Impressora")
        txtImpressora = texto("", 16f)
        imp.addView(txtImpressora)
        imp.addView(botao("Escolher a impressora") { escolherImpressora() })
        imp.addView(botao("Imprimir um teste", false) { testar() })
        coluna.addView(imp)

        // 2. loja
        val loja = cartao("2. Ligar à loja")
        caixaParear = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        caixaParear.addView(texto("No painel da loja, toque em \"⋯\" → \"Impressora\" → \"Celular da banca\" → \"Gerar código\". Digite aqui o código que aparecer.", 15f, false, TEXTO_SUAVE))
        campoCodigo = campo("Código de 8 letras").apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            filters = arrayOf(InputFilter.LengthFilter(12), InputFilter.AllCaps())
            letterSpacing = 0.15f
            gravity = Gravity.CENTER
        }
        caixaParear.addView(campoCodigo)
        btnEntrar = botao("Ligar à loja") { ligar(campoCodigo.text.toString(), campoServidor.text.toString()) }
        caixaParear.addView(btnEntrar)
        val outra = texto("A loja não é usebanca.com? Toque aqui.", 14f, false, VERDE).apply { setPadding(0, dp(12), 0, dp(4)) }
        campoServidor = campo("Endereço da loja").apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(cfg.servidor.removePrefix("https://"))
            visibility = View.GONE
        }
        outra.setOnClickListener { campoServidor.visibility = if (campoServidor.visibility == View.VISIBLE) View.GONE else View.VISIBLE }
        caixaParear.addView(outra); caixaParear.addView(campoServidor)
        caixaLigada = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        txtLoja = texto("", 16f)
        caixaLigada.addView(txtLoja)
        caixaLigada.addView(botao("Desligar desta loja", false) { desparear() })
        loja.addView(caixaParear); loja.addView(caixaLigada)
        coluna.addView(loja)

        // 3. sempre ligada
        val sempre = cartao("3. Deixar sempre ligada")
        sempre.addView(texto("Para imprimir com a tela bloqueada, o celular precisa deixar o app trabalhar. Libere o que estiver com ✗.", 15f, false, TEXTO_SUAVE))
        listaChecks = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        sempre.addView(listaChecks)
        coluna.addView(sempre)

        coluna.addView(texto("Versão ${BuildConfig.VERSION_NAME}", 13f, false, TEXTO_SUAVE).apply { gravity = Gravity.CENTER; setPadding(0, dp(20), 0, 0) })

        return ScrollView(this).apply {
            setBackgroundColor(FUNDO)
            isFillViewport = true
            addView(coluna)
        }
    }

    // ------------------------------------------------------------ estado na tela
    private fun atualizar() {
        val s = PonteService.instancia
        val (titulo, cor) = when {
            !cfg.pareado -> "Falta ligar à loja" to ALERTA
            !cfg.ligada -> "Ponte desligada" to ALERTA
            s == null && !Horario.podeRodar(cfg) -> listOf("Desligada pelo horário", Horario.textoLiga(cfg)).filter { it.isNotEmpty() }.joinToString(" · ") to ALERTA
            s == null -> "Ponte parada. Toque em Ligar a ponte." to ERRO
            else -> PonteService.estado to (if (PonteService.estadoOk) VERDE else ERRO)
        }
        txtEstado.text = titulo
        txtEstado.setTextColor(cor)
        val partes = mutableListOf<String>()
        if (!cfg.pareado && cfg.avisoDesligado.isNotEmpty()) partes.add(cfg.avisoDesligado)
        if (cfg.pareado && cfg.loja.isNotEmpty()) partes.add("Loja: ${cfg.loja}")
        if (cfg.pareado && Horario.temHorario(cfg.ligarAs, cfg.desligarAs)) {
            partes.add(if (System.currentTimeMillis() < cfg.forcarAte)
                "Ligada à mão até ${SimpleDateFormat("HH:mm", Locale("pt", "BR")).format(Date(cfg.forcarAte))} (horário da loja: ${cfg.ligarAs} às ${cfg.desligarAs})"
            else "Horário: liga às ${cfg.ligarAs} e desliga às ${cfg.desligarAs}")
        }
        if (PonteService.ultimaImpressao > 0) {
            val hora = SimpleDateFormat("HH:mm", Locale("pt", "BR")).format(Date(PonteService.ultimaImpressao))
            partes.add("Última impressão às $hora · ${PonteService.impressasHoje} hoje")
        }
        txtDetalhe.text = partes.joinToString("\n")
        txtDetalhe.visibility = if (partes.isEmpty()) View.GONE else View.VISIBLE
        btnLigar.visibility = if (cfg.pareado) View.VISIBLE else View.GONE
        btnLigar.text = if (cfg.ligada && s != null) "Desligar a ponte" else "Ligar a ponte"

        txtImpressora.text = when {
            cfg.impressoraEndereco.isEmpty() -> "Nenhuma impressora escolhida."
            PonteService.erroImpressora.isNotEmpty() -> "${cfg.impressoraNome}\n✗ ${PonteService.erroImpressora}"
            else -> "${cfg.impressoraNome}\n✓ Escolhida" + (if (cfg.conexao == "ble") " (Bluetooth de baixo consumo)" else if (cfg.conexao == "spp") " (Bluetooth)" else "")
        }

        caixaParear.visibility = if (cfg.pareado) View.GONE else View.VISIBLE
        caixaLigada.visibility = if (cfg.pareado) View.VISIBLE else View.GONE
        if (cfg.pareado) {
            val host = try { URL(cfg.servidor).host } catch (_: Exception) { cfg.servidor }
            txtLoja.text = "✓ Ligada a ${cfg.loja.ifEmpty { "loja" }}\n$host"
        }
        pintarChecks()
    }

    private data class Item(val ok: Boolean?, val texto: String, val botao: String?, val acao: (() -> Unit)?)

    private fun pintarChecks() {
        val itens = mutableListOf<Item>()
        val bt = adaptador()
        if (Build.VERSION.SDK_INT >= 31) itens.add(Item(temPermissaoBt(), "Permissão de Bluetooth", "Permitir") { pedirBt(null) })
        else itens.add(Item(temPermissaoBt(), "Permissão para achar a impressora", "Permitir") { pedirBt(null) })
        itens.add(Item(bt?.isEnabled == true, "Bluetooth do celular ligado", "Ligar") { abrir(Settings.ACTION_BLUETOOTH_SETTINGS) })
        if (Build.VERSION.SDK_INT >= 33) itens.add(Item(checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
            "Avisos na barra (para saber se parou)", "Permitir") { pedir(arrayOf(Manifest.permission.POST_NOTIFICATIONS), null) })
        if (Build.VERSION.SDK_INT >= 23) itens.add(Item(semRestricaoDeBateria(), "Bateria sem restrição para a Ponte", "Liberar") { pedirBateria() })
        dicaDoFabricante()?.let { (t, a) -> itens.add(Item(null, t, "Abrir ajustes", a)) }
        val assinatura = itens.joinToString("|") { "${it.ok}${it.texto}" }
        if (assinatura == assinaturaChecks) return
        assinaturaChecks = assinatura
        listaChecks.removeAllViews()
        for (item in itens) {
            val linha = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(8), 0, dp(8))
            }
            val marca = when (item.ok) { true -> "✓  "; false -> "✗  "; null -> "•  " }
            val t = texto(marca + item.texto, 15f, item.ok == false, when (item.ok) { true -> VERDE; false -> ERRO; null -> TEXTO })
            t.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            linha.addView(t)
            val acao = item.acao
            val rotulo = item.botao
            if (item.ok != true && rotulo != null && acao != null) {
                linha.addView(Button(this).apply {
                    text = rotulo
                    isAllCaps = false
                    setTextColor(Color.WHITE)
                    background = fundo(VERDE, VERDE, 12)
                    minHeight = dp(44)
                    setPadding(dp(14), 0, dp(14), 0)
                    setOnClickListener { acao() }
                })
            }
            listaChecks.addView(linha)
        }
    }

    // ------------------------------------------------------------ ligar / desligar
    private fun alternarLigada() {
        if (cfg.ligada && PonteService.instancia != null) {
            AlertDialog.Builder(this).setTitle("Desligar a ponte?")
                .setMessage("Enquanto estiver desligada, este celular não imprime. Os pedidos ficam guardados na loja.")
                .setPositiveButton("Desligar") { _, _ -> cfg.ligada = false; cfg.forcarAte = 0L; Vigia.cancelar(this); Horario.cancelar(this); PonteService.parar(this); atualizar() }
                .setNegativeButton("Voltar", null).show()
        } else {
            cfg.ligada = true
            // fora do horário da loja: ligar à mão vale por 3 horas (feira que passou da hora)
            if (!Horario.podeRodar(cfg)) {
                cfg.forcarAte = System.currentTimeMillis() + Horario.MAO_MS
                aviso("Fora do horário da loja: fica ligada por 3 horas. Para mudar o horário, vá em Impressora no painel.")
            }
            if (!PonteService.iniciar(this)) aviso("O Android não deixou ligar agora. Abra o app de novo.")
            Vigia.agendar(this)
            atualizar()
        }
    }

    private fun tratarLink(i: Intent?) {
        if (i == null) return
        val dados: Uri = i.data ?: return
        if (dados.scheme != "bancaponte" || dados.host != "parear") return
        val codigo = dados.getQueryParameter("c").orEmpty()
        val srv = dados.getQueryParameter("s").orEmpty()
        i.data = null
        if (codigo.isEmpty()) return
        val seguir = {
            campoCodigo.setText(codigo)
            if (srv.isNotEmpty()) campoServidor.setText(srv.removePrefix("https://"))
            ligar(codigo, srv.ifEmpty { cfg.servidor })
        }
        if (cfg.pareado) {
            AlertDialog.Builder(this).setTitle("Ligar a outra loja?")
                .setMessage("Este celular já imprime para ${cfg.loja.ifEmpty { "uma loja" }}. Trocar?")
                .setPositiveButton("Trocar") { _, _ -> cfg.desparear(); seguir() }
                .setNegativeButton("Voltar", null).show()
        } else seguir()
    }

    private fun normalizarServidor(s: String): String? {
        var t = s.trim().trimEnd('/')
        if (t.isEmpty()) return Config.SERVIDOR_PADRAO
        if (!t.startsWith("http://") && !t.startsWith("https://")) t = "https://$t"
        val u = try { URL(t) } catch (_: Exception) { return null }
        if (u.protocol != "https" || u.host.isNullOrBlank() || !u.host.contains('.')) return null
        return "https://" + u.host + (if (u.port > 0) ":" + u.port else "")
    }

    private fun ligar(codigoBruto: String, servidorBruto: String) {
        val codigo = codigoBruto.uppercase(Locale.ROOT).replace(Regex("[^A-Z0-9]"), "")
        if (codigo.length != 8) { aviso("O código tem 8 letras e números. Confira no painel."); return }
        val srv = normalizarServidor(servidorBruto) ?: run { aviso("Endereço da loja inválido."); return }
        btnEntrar.isEnabled = false
        btnEntrar.text = "Ligando…"
        Thread {
            val antes = cfg.servidor
            val msg: String = try {
                cfg.servidor = srv
                val r = Servidor(cfg).chamar(JSONObject().put("op", "entrar").put("codigo", codigo).put("app", infoDoApp(this)), autenticar = false)
                val token = r.optString("token")
                if (token.isEmpty()) throw IllegalStateException("sem token")
                cfg.token = token
                cfg.loja = r.optString("loja")
                r.optJSONObject("cfg")?.let { c ->
                    val l = c.optInt("largura", 80); if (l == 58 || l == 80) cfg.largura = l
                    cfg.acentos = c.optBoolean("acentos", false)
                }
                cfg.ligada = true
                cfg.avisoDesligado = ""
                ""
            } catch (e: Servidor.Erro) {
                cfg.servidor = antes
                e.message ?: "A loja recusou o código."
            } catch (_: Exception) {
                cfg.servidor = antes
                "Não consegui falar com a loja. Confira a internet e tente de novo."
            }
            runOnUiThread {
                btnEntrar.isEnabled = true
                btnEntrar.text = "Ligar à loja"
                if (msg.isEmpty()) {
                    campoCodigo.setText("")
                    aviso("Pronto! Ligada à ${cfg.loja.ifEmpty { "loja" }}.")
                    PonteService.iniciar(this)
                    Vigia.agendar(this)
                } else aviso(msg)
                atualizar()
            }
        }.start()
    }

    private fun desparear() {
        AlertDialog.Builder(this).setTitle("Desligar desta loja?")
            .setMessage("Este celular para de imprimir. Para voltar, gere um código novo no painel.")
            .setPositiveButton("Desligar") { _, _ ->
                Vigia.cancelar(this)
                PonteService.parar(this)
                // avisa a loja (que apaga este celular de lá) e só depois esquece o token
                Thread {
                    try { Servidor(cfg).chamar(JSONObject().put("op", "sair")) } catch (_: Exception) { }
                    runOnUiThread { cfg.desparear(); atualizar() }
                }.start()
            }
            .setNegativeButton("Voltar", null).show()
    }

    // ------------------------------------------------------------ impressora
    private fun adaptador(): BluetoothAdapter? = (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private fun permissoesBt(): Array<String> =
        if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

    private fun temPermissaoBt(): Boolean = Build.VERSION.SDK_INT < 23 ||
        permissoesBt().all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    private fun pedir(perms: Array<String>, depois: (() -> Unit)?) {
        if (Build.VERSION.SDK_INT < 23) { depois?.invoke(); return }
        depoisDaPermissao = depois
        requestPermissions(perms, 10)
    }

    private fun pedirBt(depois: (() -> Unit)?) = pedir(permissoesBt(), depois)

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val depois = depoisDaPermissao
        depoisDaPermissao = null
        if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) depois?.invoke()
        else if (grantResults.isNotEmpty()) aviso("Sem essa permissão a ponte não consegue imprimir. Se não aparecer a pergunta, libere em Ajustes → Apps → Ponte da Banca → Permissões.")
        atualizar()
    }

    private fun nomeDe(d: BluetoothDevice): String = try { d.name?.takeIf { it.isNotBlank() } ?: d.address } catch (_: SecurityException) { d.address }

    private fun pareceImpressora(d: BluetoothDevice): Boolean = try {
        d.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.IMAGING ||
            Regex("print|pos|gs-|golden|therm|pt-|mtp|xp-|rpp|gprinter|mpt|bt-p", RegexOption.IGNORE_CASE).containsMatchIn(nomeDe(d))
    } catch (_: SecurityException) { false }

    private fun escolherImpressora() {
        if (!temPermissaoBt()) { pedirBt { escolherImpressora() }; return }
        val a = adaptador() ?: run { aviso("Este celular não tem Bluetooth."); return }
        if (!a.isEnabled) { aviso("Ligue o Bluetooth do celular primeiro."); abrir(Settings.ACTION_BLUETOOTH_SETTINGS); return }
        val todos: List<BluetoothDevice> = try { a.bondedDevices?.toList().orEmpty() } catch (_: SecurityException) { emptyList() }
        val pareados = todos.sortedByDescending { pareceImpressora(it) }
        val nomes = pareados.map { nomeDe(it) + if (pareceImpressora(it)) "  (impressora)" else "" }.toMutableList()
        nomes.add("Procurar impressoras por perto…")
        nomes.add("Parear uma impressora nova (ajustes do Bluetooth)")
        AlertDialog.Builder(this).setTitle("Qual é a impressora?")
            .setItems(nomes.toTypedArray()) { _, i ->
                when {
                    i < pareados.size -> salvarImpressora(pareados[i])
                    i == pareados.size -> procurar()
                    else -> {
                        aviso("Pareie a impressora (a senha costuma ser 0000 ou 1234) e volte aqui.")
                        abrir(Settings.ACTION_BLUETOOTH_SETTINGS)
                    }
                }
            }
            .setNegativeButton("Voltar", null).show()
    }

    private fun procurar() {
        val a = adaptador() ?: return
        val scanner = a.bluetoothLeScanner ?: run { aviso("Ligue o Bluetooth do celular."); return }
        val achados = LinkedHashMap<String, BluetoothDevice>()
        val retorno = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val d = result.device
                val nome = try { d.name } catch (_: SecurityException) { null }
                if (!nome.isNullOrBlank()) achados[d.address] = d
            }
        }
        val janela = AlertDialog.Builder(this).setTitle("Procurando…").setMessage("Deixe a impressora ligada e perto do celular.").setCancelable(false).show()
        try { scanner.startScan(retorno) } catch (_: Exception) { janela.dismiss(); pedirBt { procurar() }; return }
        principal.postDelayed({
            try { scanner.stopScan(retorno) } catch (_: Exception) { }
            janela.dismiss()
            val lista = achados.values.toList().sortedByDescending { pareceImpressora(it) }
            if (lista.isEmpty()) { aviso("Não achei nenhuma. Confira se a impressora está ligada, ou pareie nos ajustes do Bluetooth."); return@postDelayed }
            AlertDialog.Builder(this).setTitle("Achei estas")
                .setItems(lista.map { nomeDe(it) }.toTypedArray()) { _, i -> salvarImpressora(lista[i]) }
                .setNegativeButton("Voltar", null).show()
        }, 8000)
    }

    private fun salvarImpressora(d: BluetoothDevice) {
        cfg.impressoraEndereco = d.address
        cfg.impressoraNome = nomeDe(d)
        cfg.conexao = ""
        PonteService.impressoraTestada = false
        PonteService.instancia?.impressoraTrocada()
        atualizar()
        AlertDialog.Builder(this).setTitle("Impressora escolhida")
            .setMessage("${cfg.impressoraNome}\n\nQuer imprimir um teste agora?")
            .setPositiveButton("Imprimir teste") { _, _ -> testar() }
            .setNegativeButton("Depois", null).show()
    }

    private fun testar() {
        if (cfg.impressoraEndereco.isEmpty()) { escolherImpressora(); return }
        if (!temPermissaoBt()) { pedirBt { testar() }; return }
        aviso("Imprimindo o teste…")
        Thread {
            val s = PonteService.instancia
            val erro: String? = if (s != null) s.imprimirTeste() else try {
                val imp = Impressora(this, cfg)
                try { imp.imprimir(Impressora.paginaDeTeste(cfg.impressoraNome, cfg.largura)) } finally { imp.fechar() }
                PonteService.impressoraTestada = true
                null
            } catch (e: Exception) { (e as? Impressora.Falha)?.message ?: "A impressora não respondeu." }
            runOnUiThread { aviso(erro ?: "Teste enviado. Saiu a folha? Então está tudo certo."); atualizar() }
        }.start()
    }

    // ------------------------------------------------------------ bateria e fabricante
    private fun semRestricaoDeBateria(): Boolean = Build.VERSION.SDK_INT < 23 ||
        (getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)

    @SuppressLint("BatteryLife")
    private fun pedirBateria() {
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (_: Exception) {
            abrir(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        }
    }

    /** Alguns fabricantes fecham apps em segundo plano por conta própria: a dica certa para cada um. */
    private fun dicaDoFabricante(): Pair<String, () -> Unit>? {
        val m = Build.MANUFACTURER.lowercase(Locale.ROOT)
        return when {
            m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") ->
                "Xiaomi: ligue a \"Inicialização automática\" da Ponte e, em Economia de bateria, escolha \"Sem restrições\"." to { abrirAutoInicio() }
            m.contains("samsung") ->
                "Samsung: em Bateria, escolha \"Sem restrições\" e confira que a Ponte não está em \"Apps em suspensão\"." to { abrirDetalhes() }
            m.contains("huawei") || m.contains("honor") ->
                "Huawei/Honor: em \"Inicialização de apps\", deixe a Ponte no manual com tudo ligado." to { abrirDetalhes() }
            m.contains("oppo") || m.contains("realme") || m.contains("oneplus") || m.contains("vivo") ->
                "Permita \"início automático\" e \"atividade em segundo plano\" para a Ponte nos ajustes do app." to { abrirDetalhes() }
            else -> null
        }
    }

    private fun abrirAutoInicio() {
        val alvos = listOf(
            ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            ComponentName("com.miui.securitycenter", "com.miui.powercenter.PowerSettings"),
        )
        for (c in alvos) {
            try { startActivity(Intent().setComponent(c)); return } catch (_: Exception) { }
        }
        abrirDetalhes()
    }

    private fun abrirDetalhes() {
        try { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) } catch (_: Exception) { }
    }

    private fun abrir(acao: String) {
        try { startActivity(Intent(acao)) } catch (_: ActivityNotFoundException) { abrirDetalhes() } catch (_: Exception) { }
    }

    private fun aviso(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    companion object {
        private val VERDE = Color.rgb(0x1a, 0x3a, 0x2a)
        private val FUNDO = Color.rgb(0xf6, 0xf1, 0xe4)
        private val BORDA = Color.rgb(0xe0, 0xdc, 0xd4)
        private val TEXTO = Color.rgb(0x22, 0x22, 0x22)
        private val TEXTO_SUAVE = Color.rgb(0x5a, 0x5a, 0x55)
        private val ERRO = Color.rgb(0xb3, 0x26, 0x1e)
        private val ALERTA = Color.rgb(0x8a, 0x53, 0x00)
    }
}
