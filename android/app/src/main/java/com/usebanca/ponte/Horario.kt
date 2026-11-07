package com.usebanca.ponte

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import java.util.Calendar

/**
 * HORÁRIO DA PONTE: a loja escolhe no painel (Impressora) a hora de ligar e a de desligar.
 * Fora do horário o serviço para e o aviso da barra some; na hora de ligar, um alarme levanta
 * o serviço de novo. Os pedidos que chegarem com ele desligado ficam na fila da loja e saem
 * quando ele voltar (nada se perde).
 *
 * Sem horário (os dois vazios, ou iguais) = sempre ligada, como antes.
 * Ligar à mão no app fora do horário vale por 3 horas (feira que passou da hora).
 * A mesma regra existe no site, em js/impressao-fila-lib.js (dentroDoHorario).
 */
object Horario {
    private val FORMATO = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$")
    const val MAO_MS = 3L * 60 * 60 * 1000

    /** "07:30" → 450 minutos do dia; inválido → null. */
    fun minutos(t: String): Int? {
        val m = FORMATO.find(t.trim()) ?: return null
        return m.groupValues[1].toInt() * 60 + m.groupValues[2].toInt()
    }

    fun temHorario(ligar: String, desligar: String): Boolean {
        val l = minutos(ligar) ?: return false
        val d = minutos(desligar) ?: return false
        return l != d
    }

    /** Dentro do horário neste minuto do dia? (desligar antes de ligar = passa da meia-noite) */
    fun dentro(ligar: String, desligar: String, agoraMin: Int): Boolean {
        if (!temHorario(ligar, desligar)) return true
        val l = minutos(ligar)!!
        val d = minutos(desligar)!!
        return if (l < d) agoraMin in l until d else agoraMin >= l || agoraMin < d
    }

    private fun minutoAgora(agora: Long): Int {
        val c = Calendar.getInstance().apply { timeInMillis = agora }
        return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
    }

    /** Pode rodar agora? (dentro do horário, ou ligada à mão há menos de 3 horas) */
    fun podeRodar(cfg: Config, agora: Long = System.currentTimeMillis()): Boolean =
        agora < cfg.forcarAte || dentro(cfg.ligarAs, cfg.desligarAs, minutoAgora(agora))

    /** Próxima vez (em ms do relógio) que o horário de ligar chega. */
    fun proximaLigada(ligar: String, agora: Long = System.currentTimeMillis()): Long? {
        val l = minutos(ligar) ?: return null
        val c = Calendar.getInstance().apply {
            timeInMillis = agora
            set(Calendar.HOUR_OF_DAY, l / 60); set(Calendar.MINUTE, l % 60); set(Calendar.SECOND, 30); set(Calendar.MILLISECOND, 0)
        }
        if (c.timeInMillis <= agora) c.add(Calendar.DAY_OF_MONTH, 1)
        return c.timeInMillis
    }

    private fun pendente(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx, 8, Intent(ctx, VigiaReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /**
     * Agenda o alarme da hora de ligar. Usa o alarme que pode tocar com o celular dormindo
     * (com a bateria liberada para o app, ele levanta o serviço); o vigia de 15 em 15 min
     * continua como reserva, caso o Android atrase este.
     */
    fun agendarLigar(ctx: Context, cfg: Config) {
        val quando = proximaLigada(cfg.ligarAs) ?: return
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, quando, pendente(ctx)) } catch (_: Exception) {
            try { am.set(AlarmManager.RTC_WAKEUP, quando, pendente(ctx)) } catch (_: Exception) { }
        }
    }

    fun cancelar(ctx: Context) {
        try { (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pendente(ctx)) } catch (_: Exception) { }
    }

    /** Texto curto para a tela e a barra: "liga às 06:00". */
    fun textoLiga(cfg: Config): String = if (minutos(cfg.ligarAs) != null) "liga sozinha às ${cfg.ligarAs}" else ""
}
