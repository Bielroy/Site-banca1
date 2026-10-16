package com.usebanca.ponte

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * O coração do app: um serviço com aviso fixo na barra (o Android não desliga serviço assim
 * com a tela bloqueada). Ele fica num laço só:
 *
 *   pergunta à loja "tem papel?" (a loja segura a resposta até 45 s) → imprime → conta o que saiu
 *
 * Bateria:
 *  - esperando a resposta, o celular pode dormir (nenhuma trava de "acordado" fica ligada);
 *  - a trava liga só o tempo de imprimir e de mandar a próxima pergunta (com prazo, nunca fica presa);
 *  - o Bluetooth fecha logo depois de imprimir;
 *  - impressora desligada ou sem internet: tenta de novo com intervalos cada vez maiores.
 */
class PonteService : Service() {

    companion object {
        private const val CANAL_STATUS = "status"
        private const val CANAL_ALERTA = "alerta"
        private const val ID_STATUS = 1
        private const val ID_ALERTA = 2
        private const val ESPERA_S = 45
        private const val ALERTAR_DEPOIS_MS = 3L * 60 * 1000

        @Volatile var instancia: PonteService? = null
            private set
        /** O que a tela do app mostra. */
        @Volatile var estado: String = "Desligada"
            private set
        @Volatile var estadoOk: Boolean = false
            private set
        @Volatile var ultimaImpressao: Long = 0L
            private set
        @Volatile var impressasHoje: Int = 0
            private set
        @Volatile var erroImpressora: String = ""
            private set
        @Volatile var impressoraTestada: Boolean = false
        private var diaContado = ""

        /** Liga o serviço. Devolve false se o Android não deixou (app em segundo plano sem liberação de bateria). */
        fun iniciar(ctx: Context): Boolean = try {
            val i = Intent(ctx, PonteService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            true
        } catch (_: Exception) {
            false
        }

        fun parar(ctx: Context) {
            ctx.stopService(Intent(ctx, PonteService::class.java))
        }
    }

    private lateinit var cfg: Config
    private lateinit var servidor: Servidor
    lateinit var impressora: Impressora
        private set
    private var trava: PowerManager.WakeLock? = null
    private var rede: ConnectivityManager.NetworkCallback? = null

    @Volatile private var rodando = false
    @Volatile private var geracao = 0
    @Volatile private var fio: Thread? = null
    @Volatile private var dormindo = false
    @Volatile private var tentarJa = false
    @Volatile private var ultimoSinal = 0L
    private var erroDesde = 0L
    private var alertou = false
    private var textoAviso = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instancia = this
        cfg = Config(this)
        servidor = Servidor(cfg)
        impressora = Impressora(this, cfg)
        criarCanais()
        trava = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PonteDaBanca:imprimindo").apply { setReferenceCounted(false) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!entrarEmPrimeiroPlano()) { stopSelf(); return START_NOT_STICKY }
        if (!cfg.pareado || !cfg.ligada) {
            mudar(if (!cfg.pareado) "Falta ligar à loja" else "Desligada", false)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!rodando) {
            rodando = true
            ouvirRede()
            novoLaco()
        }
        Vigia.agendar(this)
        return START_STICKY
    }

    override fun onDestroy() {
        rodando = false
        geracao++
        servidor.cancelar()
        fio?.interrupt()
        pararDeOuvirRede()
        try { impressora.fechar() } catch (_: Exception) { }
        soltar()
        if (instancia === this) instancia = null
        estado = if (cfg.pareado) "Desligada" else "Falta ligar à loja"
        estadoOk = false
        super.onDestroy()
    }

    private fun entrarEmPrimeiroPlano(): Boolean = try {
        val texto = if (rodando && textoAviso.isNotEmpty()) textoAviso else "Ligando…"
        textoAviso = texto
        val n = aviso(texto)
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID_STATUS, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        else startForeground(ID_STATUS, n)
        true
    } catch (_: Exception) {
        false
    }

    // ------------------------------------------------------------ vigia e rede
    /** Chamado pelo alarme de 15 em 15 min: se o laço travou (rede que sumiu sem avisar), começa de novo. */
    fun vigiar() {
        if (!rodando) return
        if (fio?.isAlive != true || SystemClock.elapsedRealtime() - ultimoSinal > 4L * 60 * 1000) novoLaco()
    }

    /** Algo mudou (rede voltou, impressora trocada): para de esperar e tenta já. */
    fun cutucar() {
        if (dormindo) fio?.interrupt() else { tentarJa = true; servidor.cancelar() }
    }

    private fun ouvirRede() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // trocou de rede (Wi-Fi ↔ dados) ou a internet voltou: a conversa antiga morreu
                if (SystemClock.elapsedRealtime() - ultimoSinal > 3000) cutucar()
            }
        }
        try { cm.registerDefaultNetworkCallback(cb); rede = cb } catch (_: Exception) { }
    }

    private fun pararDeOuvirRede() {
        val cb = rede ?: return
        try { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(cb) } catch (_: Exception) { }
        rede = null
    }

    @Synchronized
    private fun novoLaco() {
        val minha = ++geracao
        servidor.cancelar()
        fio?.interrupt()
        ultimoSinal = SystemClock.elapsedRealtime()
        fio = Thread({ laco(minha) }, "ponte").apply { isDaemon = true; start() }
    }

    private fun segurar(ms: Long) { try { trava?.acquire(ms) } catch (_: Exception) { } }
    private fun soltar() { try { if (trava?.isHeld == true) trava?.release() } catch (_: Exception) { } }

    // ------------------------------------------------------------ o laço
    private fun laco(minha: Int) {
        var falhasRede = 0
        var falhasImpressora = 0
        var pausaAte = 0L
        while (rodando && minha == geracao) {
            Thread.interrupted()                                     // limpa um "acorda" que chegou atrasado
            ultimoSinal = SystemClock.elapsedRealtime()
            try {
                val agora = SystemClock.elapsedRealtime()
                val pausa = agora < pausaAte
                val feitos = cfg.feitos()
                val espera = when {
                    feitos.length() > 0 -> 0                         // tem o que contar: resposta na hora
                    pausa -> ((pausaAte - agora) / 1000).toInt().coerceIn(1, ESPERA_S)
                    else -> ESPERA_S
                }
                val corpo = JSONObject()
                    .put("op", "aguardar").put("espera", espera).put("pausa", pausa)
                    .put("feitos", feitos).put("impressora", estadoDaImpressora()).put("app", infoDoApp(this))
                val r = servidor.chamar(corpo, true, (espera + 30) * 1000) { soltar() }
                segurar(15_000)                                      // chegou resposta: fica acordado o tempo de agir
                if (minha != geracao) break
                cfg.tirarFeitos(feitos)
                falhasRede = 0
                lerResposta(r)
                val trabalhos = r.optJSONArray("trabalhos") ?: JSONArray()
                if (trabalhos.length() == 0) {
                    if (!pausa) { impressora.fecharSeParada(15_000); pronto() }
                    continue
                }
                segurar(3L * 60 * 1000)
                if (imprimirTudo(trabalhos)) {
                    falhasImpressora++
                    pausaAte = SystemClock.elapsedRealtime() + atrasoImpressora(falhasImpressora)
                } else {
                    falhasImpressora = 0
                    pausaAte = 0
                }
            } catch (e: Servidor.Erro) {
                if (e.desligado) { desligadoPeloPainel(); return }
                falhasRede++
                problema("A loja não respondeu direito (${e.message}). Tento de novo sozinha.")
                dormir(atrasoRede(falhasRede, e.codigo == 429))
            } catch (_: InterruptedException) {
                // acordada de propósito
            } catch (_: Exception) {
                if (!rodando || minha != geracao) break
                if (tentarJa) { tentarJa = false; continue }
                falhasRede++
                problema(if (temInternet()) "Sem resposta da loja. Tento de novo sozinha." else "Sem internet. Volto sozinha quando a internet voltar.")
                dormir(atrasoRede(falhasRede, false))
            }
        }
        soltar()
    }

    /** Imprime em ordem. Devolve true se a impressora falhou (o resto volta para a fila). */
    private fun imprimirTudo(lista: JSONArray): Boolean {
        for (i in 0 until lista.length()) {
            val t = lista.optJSONObject(i) ?: continue
            val chave = t.optString("chave")
            if (chave.isEmpty()) continue
            if (cfg.jaImpresso(chave)) { cfg.addFeito(chave, true, null); continue }
            val bytes = try { Base64.decode(t.optString("bytes"), Base64.DEFAULT) } catch (_: Exception) { ByteArray(0) }
            if (bytes.isEmpty()) { cfg.addFeito(chave, true, null); continue }
            mudar("Imprimindo: ${t.optString("titulo").ifEmpty { "papel da loja" }}", true)
            try {
                impressora.imprimir(bytes)
                cfg.marcarImpresso(chave)
                cfg.addFeito(chave, true, null)
                contarImpressao()
                erroImpressora = ""
            } catch (e: Exception) {
                val msg = (e as? Impressora.Falha)?.message ?: "A impressora não respondeu."
                erroImpressora = msg
                cfg.addFeito(chave, false, msg)
                for (j in i + 1 until lista.length()) {
                    val outra = lista.optJSONObject(j)?.optString("chave").orEmpty()
                    if (outra.isNotEmpty() && !cfg.jaImpresso(outra)) cfg.addFeito(outra, false, "não chegou a tentar")
                }
                problema("$msg Tento de novo sozinha.")
                return true
            }
        }
        pronto()
        return false
    }

    /** Teste pedido na tela do app, pela mesma conexão do serviço (nunca dois falando com a impressora). */
    fun imprimirTeste(): String? = try {
        impressora.imprimir(Impressora.paginaDeTeste(cfg.impressoraNome.ifEmpty { "impressora" }, cfg.largura))
        erroImpressora = ""
        impressoraTestada = true
        null
    } catch (e: Exception) {
        val msg = (e as? Impressora.Falha)?.message ?: "A impressora não respondeu."
        erroImpressora = msg
        msg
    }

    /** A impressora foi trocada no app: fecha a conexão velha. */
    fun impressoraTrocada() {
        try { impressora.fechar() } catch (_: Exception) { }
        erroImpressora = ""
        cutucar()
    }

    private fun lerResposta(r: JSONObject) {
        r.optString("loja").takeIf { it.isNotEmpty() }?.let { if (it != cfg.loja) cfg.loja = it }
        r.optJSONObject("cfg")?.let { c ->
            val l = c.optInt("largura", cfg.largura)
            if (l == 58 || l == 80) cfg.largura = l
            cfg.acentos = c.optBoolean("acentos", cfg.acentos)
        }
    }

    private fun estadoDaImpressora(): JSONObject = JSONObject()
        .put("estado", when {
            cfg.impressoraEndereco.isEmpty() -> "nenhuma"
            erroImpressora.isNotEmpty() -> "erro"
            ultimaImpressao > 0 || impressoraTestada -> "ok"
            else -> "?"
        })
        .put("msg", erroImpressora)
        .put("nome", cfg.impressoraNome)

    private fun contarImpressao() {
        val dia = SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())
        if (dia != diaContado) { diaContado = dia; impressasHoje = 0 }
        impressasHoje++
        ultimaImpressao = System.currentTimeMillis()
    }

    private fun dormir(ms: Long) {
        dormindo = true
        try { Thread.sleep(ms) } catch (_: InterruptedException) { } finally { dormindo = false }
    }

    private fun atrasoRede(n: Int, freio: Boolean): Long =
        if (freio) 30_000L else minOf(60_000L, 3_000L shl minOf(n - 1, 5))

    /** Impressora desligada: 15 s, 30 s, 1 min, 2 min, e depois de 5 em 5 min (a noite toda sem gastar bateria). */
    private fun atrasoImpressora(n: Int): Long = when (n) {
        1 -> 15_000L
        2 -> 30_000L
        3 -> 60_000L
        4 -> 120_000L
        else -> 300_000L
    }

    private fun temInternet(): Boolean = try {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        cm.activeNetwork != null
    } catch (_: Exception) {
        true
    }

    private fun desligadoPeloPainel() {
        cfg.desparear()
        cfg.avisoDesligado = "Este celular foi desligado no painel da loja. Para voltar a imprimir, gere um código novo no painel."
        alertar("Ponte desligada pela loja", cfg.avisoDesligado)
        mudar("Falta ligar à loja", false)
        rodando = false
        Vigia.cancelar(this)
        stopSelf()
    }

    // ------------------------------------------------------------ o que aparece na tela e na barra
    private fun pronto() {
        erroDesde = 0
        if (alertou) { alertou = false; (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(ID_ALERTA) }
        val hora = if (ultimaImpressao > 0) " · última impressão às " + SimpleDateFormat("HH:mm", Locale("pt", "BR")).format(Date(ultimaImpressao)) else ""
        mudar("Pronta para imprimir$hora", true)
    }

    private fun problema(msg: String) {
        val agora = SystemClock.elapsedRealtime()
        if (erroDesde == 0L) erroDesde = agora
        mudar(msg, false)
        if (!alertou && agora - erroDesde > ALERTAR_DEPOIS_MS) { alertou = true; alertar("Impressão parada", msg) }
    }

    private fun mudar(texto: String, ok: Boolean) {
        estado = texto
        estadoOk = ok
        if (texto == textoAviso) return                              // só mexe na barra quando muda
        textoAviso = texto
        try { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ID_STATUS, aviso(texto)) } catch (_: Exception) { }
    }

    private fun criarCanais() {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CANAL_STATUS, "Ponte ligada", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Mostra que a ponte está ligada e a última impressão."
            setShowBadge(false)
        })
        nm.createNotificationChannel(NotificationChannel(CANAL_ALERTA, "Impressão parada", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Avisa quando a impressão parou e precisa de você."
        })
    }

    private fun abrirApp(): PendingIntent = PendingIntent.getActivity(
        this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    @Suppress("DEPRECATION")
    private fun construtor(canal: String): Notification.Builder =
        if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, canal) else Notification.Builder(this)

    private fun aviso(texto: String): Notification = construtor(CANAL_STATUS)
        .setSmallIcon(R.drawable.ic_notificacao)
        .setContentTitle("Ponte da Banca")
        .setContentText(texto)
        .setStyle(Notification.BigTextStyle().bigText(texto))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setContentIntent(abrirApp())
        .build()

    private fun alertar(titulo: String, texto: String) {
        val n = construtor(CANAL_ALERTA)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(Notification.BigTextStyle().bigText(texto))
            .setAutoCancel(true)
            .setContentIntent(abrirApp())
            .build()
        try { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ID_ALERTA, n) } catch (_: Exception) { }
    }
}

/** O que o app conta de si para a loja (aparece no painel). */
fun infoDoApp(ctx: Context): JSONObject {
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    val livre = Build.VERSION.SDK_INT < 23 || pm.isIgnoringBatteryOptimizations(ctx.packageName)
    val modelo = "${Build.MANUFACTURER} ${Build.MODEL}".trim().replaceFirstChar { it.uppercase() }
    return JSONObject()
        .put("versao", BuildConfig.VERSION_NAME)
        .put("android", Build.VERSION.RELEASE)
        .put("modelo", modelo)
        .put("bateria", if (livre) "sem restrição" else "com restrição")
}
