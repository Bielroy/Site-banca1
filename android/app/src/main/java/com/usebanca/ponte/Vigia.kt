package com.usebanca.ponte

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock

/**
 * Vigia: um alarme leve de 15 em 15 minutos (o Android junta com outros alarmes para gastar menos).
 * Se o serviço morreu, levanta de novo; se o laço travou, começa outro.
 */
object Vigia {
    private const val INTERVALO = 15L * 60 * 1000

    private fun pendente(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx, 7, Intent(ctx, VigiaReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun agendar(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + INTERVALO, INTERVALO, pendente(ctx))
    }

    fun cancelar(ctx: Context) {
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pendente(ctx))
    }
}

class VigiaReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val cfg = Config(ctx)
        if (!cfg.pareado || !cfg.ligada) { Vigia.cancelar(ctx); return }
        val s = PonteService.instancia
        if (s != null) s.vigiar() else PonteService.iniciar(ctx)
    }
}

/** Celular ligado de novo, ou app atualizado: a ponte volta sozinha. */
class InicioReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val a = intent.action ?: return
        if (a != Intent.ACTION_BOOT_COMPLETED && a != Intent.ACTION_MY_PACKAGE_REPLACED && a != "android.intent.action.QUICKBOOT_POWERON") return
        val cfg = Config(ctx)
        if (cfg.pareado && cfg.ligada) {
            PonteService.iniciar(ctx)
            Vigia.agendar(ctx)
        }
    }
}
