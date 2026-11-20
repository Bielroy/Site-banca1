package com.usebanca.ponte

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothSocket
import android.bluetooth.BluetoothStatusCodes
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.text.Normalizer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * A impressora térmica, por Bluetooth.
 *
 * Primeiro tenta o Bluetooth "clássico" (SPP, o mesmo jeito de um fone pareado). Se a impressora
 * só tiver o Bluetooth de baixo consumo (BLE, o que o painel usa no navegador), usa ele.
 * Guarda qual deu certo para ir direto da próxima vez.
 *
 * A conexão abre quando chega papel e fecha pouco depois (o serviço chama fecharSeParada):
 * a impressora e o celular não ficam gastando bateria com o Bluetooth à toa.
 */
@SuppressLint("MissingPermission")
class Impressora(private val contexto: Context, private val cfg: Config) {
    open class Falha(mensagem: String) : Exception(mensagem)
    class SemPapel : Falha("A impressora está sem papel.")

    private var spp: BluetoothSocket? = null
    private var gatt: BluetoothGatt? = null
    @Volatile private var canal: BluetoothGattCharacteristic? = null
    @Volatile private var mtu = 23
    @Volatile private var ultimoUso = 0L
    private var usouConexaoAberta = false

    private val adaptador: BluetoothAdapter?
        get() = (contexto.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    fun temPermissao(): Boolean = Build.VERSION.SDK_INT < 31 ||
        contexto.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    /**
     * Manda os bytes para a impressora. Se a conexão que já estava aberta cair no meio,
     * tenta mais uma vez com conexão nova. Se nem conectar, não insiste (a impressora está desligada).
     */
    @Synchronized
    fun imprimir(bytes: ByteArray) {
        ultimoUso = SystemClock.elapsedRealtime()
        usouConexaoAberta = false
        try {
            enviar(bytes)
        } catch (e: SemPapel) {
            fechar(); throw e
        } catch (e: Exception) {
            // só tenta de novo se caiu uma conexão que já estava aberta (a impressora pode ter dormido)
            val tentarDeNovo = usouConexaoAberta && e !is Falha
            fechar()
            if (!tentarDeNovo) throw Falha(traduzir(e))
            try {
                enviar(bytes)
            } catch (e2: SemPapel) {
                fechar(); throw e2
            } catch (e2: Exception) {
                fechar(); throw Falha(traduzir(e2))
            }
        }
        ultimoUso = SystemClock.elapsedRealtime()
    }

    /** Fecha o Bluetooth se nada saiu nos últimos `ms` milissegundos. */
    @Synchronized
    fun fecharSeParada(ms: Long) {
        if ((spp != null || gatt != null) && SystemClock.elapsedRealtime() - ultimoUso > ms) fechar()
    }

    @Synchronized
    fun fechar() {
        try { spp?.close() } catch (_: Exception) { }
        spp = null
        try { gatt?.disconnect() } catch (_: Exception) { }
        try { gatt?.close() } catch (_: Exception) { }
        gatt = null
        canal = null
    }

    private fun traduzir(e: Exception): String = when (e) {
        is Falha -> e.message ?: "A impressora não respondeu."
        is SecurityException -> "Falta a permissão de Bluetooth. Abra o app e toque em Permitir."
        else -> "A impressora não respondeu. Confira se ela está ligada, com papel e perto do celular."
    }

    private fun enviar(bytes: ByteArray) {
        val a = adaptador ?: throw Falha("Este celular não tem Bluetooth.")
        if (!temPermissao()) throw Falha("Falta a permissão de Bluetooth. Abra o app e toque em Permitir.")
        if (!a.isEnabled) throw Falha("O Bluetooth do celular está desligado.")
        val endereco = cfg.impressoraEndereco
        if (endereco.isEmpty() || !BluetoothAdapter.checkBluetoothAddress(endereco)) throw Falha("Nenhuma impressora escolhida no app.")
        if (spp?.isConnected == true) { usouConexaoAberta = true; escreverSpp(bytes); return }
        if (gatt != null && canal != null) { usouConexaoAberta = true; escreverBle(bytes); return }
        fechar()
        val d = a.getRemoteDevice(endereco)
        when (cfg.conexao) {
            "spp" -> { abrirSpp(d); escreverSpp(bytes) }
            "ble" -> { abrirBle(d); escreverBle(bytes) }
            else -> {
                val tipo = d.type
                if (tipo != BluetoothDevice.DEVICE_TYPE_LE) {
                    try {
                        abrirSpp(d); cfg.conexao = "spp"; escreverSpp(bytes); return
                    } catch (e: SemPapel) {
                        throw e
                    } catch (e: Exception) {
                        fechar()
                        if (tipo == BluetoothDevice.DEVICE_TYPE_CLASSIC) throw e
                    }
                }
                abrirBle(d); cfg.conexao = "ble"; escreverBle(bytes)
            }
        }
    }

    // ------------------------------------------------------------ Bluetooth clássico (SPP)
    private fun abrirSpp(d: BluetoothDevice) {
        try { adaptador?.cancelDiscovery() } catch (_: Exception) { }
        val primeiro: BluetoothSocket = d.createRfcommSocketToServiceRecord(SPP)
        try {
            primeiro.connect()
            spp = primeiro
        } catch (e: Exception) {
            try { primeiro.close() } catch (_: Exception) { }
            // plano B: algumas térmicas não anunciam o serviço; o canal 1 direto resolve
            val plano: BluetoothSocket = try {
                d.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType).invoke(d, 1) as BluetoothSocket
            } catch (_: Exception) { throw e }
            try { plano.connect() } catch (_: Exception) { try { plano.close() } catch (_: Exception) { }; throw e }
            spp = plano
        }
    }

    private fun escreverSpp(bytes: ByteArray) {
        val s = spp ?: throw IOException("sem conexão")
        if (semPapel(s)) throw SemPapel()
        val saida = s.outputStream
        var i = 0
        while (i < bytes.size) {
            val n = minOf(512, bytes.size - i)
            saida.write(bytes, i, n)
            saida.flush()
            i += n
            if (i < bytes.size) Thread.sleep(8)
        }
    }

    /**
     * Pergunta se tem papel (comando DLE EOT 4, padrão ESC/POS). Só conta como "sem papel" uma resposta
     * no formato certo com o sensor de fim de papel ligado; quem não responde segue imprimindo.
     */
    private fun semPapel(s: BluetoothSocket): Boolean {
        return try {
            val entrada = s.inputStream
            while (entrada.available() > 0) entrada.read()
            s.outputStream.write(byteArrayOf(0x10, 0x04, 0x04))
            s.outputStream.flush()
            val fim = SystemClock.elapsedRealtime() + 500
            var r = -1
            while (SystemClock.elapsedRealtime() < fim) {
                if (entrada.available() > 0) { r = entrada.read(); break }
                Thread.sleep(25)
            }
            r >= 0 && (r and 0x93) == 0x12 && (r and 0x60) == 0x60
        } catch (e: IOException) {
            throw e
        } catch (_: Exception) {
            false
        }
    }

    // ------------------------------------------------------------ Bluetooth de baixo consumo (BLE)
    @Volatile private var espera: CountDownLatch? = null
    @Volatile private var resultado = 0

    private val retorno = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, novoEstado: Int) {
            if (novoEstado == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) avisar(0)
            else { canal = null; avisar(-1) }
        }
        override fun onMtuChanged(g: BluetoothGatt, valor: Int, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) mtu = valor
            avisar(status)
        }
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) { avisar(status) }
        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) { avisar(status) }
    }

    private fun avisar(r: Int) {
        resultado = r
        espera?.countDown()
    }

    /** Faz `acao` e espera a resposta do Bluetooth. -1 caiu, -3 não aceitou o pedido, -4 não respondeu a tempo. */
    private fun aguardar(ms: Long, acao: () -> Boolean): Int {
        val l = CountDownLatch(1)
        espera = l
        resultado = -2
        if (!acao()) { espera = null; return -3 }
        val chegou = l.await(ms, TimeUnit.MILLISECONDS)
        espera = null
        return if (chegou) resultado else -4
    }

    private fun abrirBle(d: BluetoothDevice) {
        val r = aguardar(15000) {
            gatt = if (Build.VERSION.SDK_INT >= 23) d.connectGatt(contexto, false, retorno, BluetoothDevice.TRANSPORT_LE)
            else d.connectGatt(contexto, false, retorno)
            gatt != null
        }
        val g = gatt ?: throw IOException("BLE indisponível")
        if (r != 0) throw IOException("BLE não conectou ($r)")
        mtu = 23
        aguardar(4000) { g.requestMtu(247) }
        if (aguardar(10000) { g.discoverServices() } != BluetoothGatt.GATT_SUCCESS) throw IOException("BLE sem serviços")
        canal = escolherCanal(g) ?: throw Falha("Conectei, mas esta impressora não aceita impressão por Bluetooth. Escolha outra no app.")
    }

    private fun escolherCanal(g: BluetoothGatt): BluetoothGattCharacteristic? {
        val escreve = { c: BluetoothGattCharacteristic ->
            (c.properties and (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0
        }
        val servicos = g.services ?: return null
        for (u in SERVICOS) servicos.firstOrNull { it.uuid == u }?.characteristics?.firstOrNull(escreve)?.let { return it }
        for (s in servicos) {
            if (s.uuid in PADRAO_DO_BLUETOOTH) continue
            s.characteristics.firstOrNull(escreve)?.let { return it }
        }
        return null
    }

    private fun escreverBle(bytes: ByteArray) {
        val g = gatt ?: throw IOException("sem conexão")
        val c = canal ?: throw IOException("sem canal")
        val comResposta = (c.properties and BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
        val tipo = if (comResposta) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        val pedaco = if (comResposta) (mtu - 3).coerceIn(20, 180) else (mtu - 3).coerceIn(20, 100)
        var i = 0
        while (i < bytes.size) {
            val parte = bytes.copyOfRange(i, minOf(bytes.size, i + pedaco))
            var r = -3
            var tentativas = 0
            while (r == -3 && tentativas < 60) {                 // -3: a fila do Bluetooth está cheia; espera um pouco
                r = aguardar(if (comResposta) 5000L else 1000L) { escreverUm(g, c, parte, tipo) }
                if (r == -3) { Thread.sleep(20); tentativas++ }
            }
            if (r == -3 || r == -1) throw IOException("BLE parou ($r)")
            if (comResposta && r != BluetoothGatt.GATT_SUCCESS) throw IOException("BLE recusou ($r)")
            if (!comResposta) Thread.sleep(15)
            i += parte.size
        }
    }

    @Suppress("DEPRECATION")
    private fun escreverUm(g: BluetoothGatt, c: BluetoothGattCharacteristic, parte: ByteArray, tipo: Int): Boolean =
        if (Build.VERSION.SDK_INT >= 33) {
            g.writeCharacteristic(c, parte, tipo) == BluetoothStatusCodes.SUCCESS
        } else {
            c.writeType = tipo
            c.value = parte
            g.writeCharacteristic(c)
        }

    companion object {
        val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        /** Serviços das térmicas mais comuns (os mesmos que o painel usa no navegador). */
        val SERVICOS: List<UUID> = listOf(
            "000018f0-0000-1000-8000-00805f9b34fb", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "49535343-fe7d-4ae5-8fa9-9fafd205e455",
            "0000ff00-0000-1000-8000-00805f9b34fb", "0000ffe0-0000-1000-8000-00805f9b34fb", "0000fee7-0000-1000-8000-00805f9b34fb",
            "0000ae30-0000-1000-8000-00805f9b34fb", "0000fff0-0000-1000-8000-00805f9b34fb",
        ).map { UUID.fromString(it) }
        /** Serviços do próprio Bluetooth (nome do aparelho etc.): nunca são a impressora. */
        private val PADRAO_DO_BLUETOOTH: Set<UUID> = listOf(0x1800, 0x1801, 0x180A, 0x180F)
            .map { UUID.fromString(String.format(Locale.US, "%08x-0000-1000-8000-00805f9b34fb", it)) }.toSet()

        private fun semAcento(s: String): String =
            Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").replace(Regex("[^\\x20-\\x7e]"), "?")

        /** Folha de teste feita pelo próprio app (não precisa da loja): confere a impressora. */
        fun paginaDeTeste(nomeImpressora: String, largura: Int): ByteArray {
            val colunas = if (largura == 58) 32 else 48
            val out = ByteArrayOutputStream()
            fun bytes(vararg b: Int) = b.forEach { out.write(it) }
            fun linha(t: String) { out.write(semAcento(t).take(colunas).toByteArray(Charsets.US_ASCII)); out.write(0x0a) }
            bytes(0x1b, 0x40)                       // zera a impressora
            bytes(0x1b, 0x61, 1)                    // centro
            bytes(0x1d, 0x21, 0x11); linha("PONTE DA BANCA"); bytes(0x1d, 0x21, 0)
            linha("Teste de impressao")
            linha("-".repeat(colunas))
            bytes(0x1b, 0x61, 0)                    // esquerda
            linha("Impressora: $nomeImpressora")
            linha("Papel de $largura mm - $colunas letras por linha")
            linha("Data: " + SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("pt", "BR")).format(Date()))
            linha("-".repeat(colunas))
            bytes(0x1b, 0x61, 1)
            linha("Se esta folha saiu inteira,")
            linha("a ponte esta pronta.")
            bytes(0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00)   // avança e corta (quem não corta ignora)
            return out.toByteArray()
        }
    }
}
