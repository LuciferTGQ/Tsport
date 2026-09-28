package com.tsport.fitness;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.NotificationManager;
import android.app.NotificationChannel;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.UUID;

/** User-started rest timers are alarm clocks, independent of the WebView lifecycle. */
@CapacitorPlugin(name = "RestAlarm")
public class RestAlarmPlugin extends Plugin {
    @Override public void load() { deliverTap(getActivity().getIntent()); }

    @Override protected void handleOnNewIntent(Intent intent) { deliverTap(intent); }

    private void deliverTap(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("tsportAlarm", false)) return;
        JSObject target = new JSObject();
        target.put("date", intent.getStringExtra("date"));
        target.put("exerciseId", intent.getStringExtra("exerciseId"));
        intent.removeExtra("tsportAlarm");
        notifyListeners("alarmOpened", target, true);
    }

    @PluginMethod public void schedule(PluginCall call) {
        Integer id = call.getInt("id");
        Long deadline = call.getLong("deadline");
        String channel = call.getString("channelId");
        if (id == null || (id != 73101 && id != 73102) || deadline == null || channel == null) {
            call.reject("Invalid rest alarm"); return;
        }
        AlarmManager manager = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        NotificationManager notifications = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel notificationChannel = notifications.getNotificationChannel(channel);
        if (!notifications.areNotificationsEnabled() || notificationChannel == null || notificationChannel.getImportance() == NotificationManager.IMPORTANCE_NONE) {
            call.reject("请允许 Tsport 的休息通知频道"); return;
        }
        if (Build.VERSION.SDK_INT >= 31 && !manager.canScheduleExactAlarms()) {
            call.reject("请允许闹钟与提醒权限"); return;
        }
        synchronized (RestAlarmReceiver.class) {
            String token = UUID.randomUUID().toString();
            Intent intent = RestAlarmReceiver.alarmIntent(getContext(), id)
                .putExtra("token", token).putExtra("channelId", channel)
                .putExtra("title", call.getString("title", "休息结束 · Tsport"))
                .putExtra("body", call.getString("body", "准备好后再开始下一组。"))
                .putExtra("date", call.getString("date"))
                .putExtra("exerciseId", call.getString("exerciseId"));
            PendingIntent operation = PendingIntent.getBroadcast(getContext(), id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            // Commit before returning to JS: the receiver must also work after process death.
            RestAlarmReceiver.preferences(getContext()).edit().putString("alarm-" + id, token).commit();
            try {
                manager.setAlarmClock(new AlarmManager.AlarmClockInfo(
                    Math.max(System.currentTimeMillis() + 100, deadline),
                    RestAlarmReceiver.openIntent(getContext(), id, intent)), operation);
                call.resolve();
            } catch (Exception error) {
                RestAlarmReceiver.cancel(getContext(), id);
                call.reject("无法安排后台提醒", error);
            }
        }
    }

    @PluginMethod public void cancel(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null || (id != 73101 && id != 73102)) { call.reject("Invalid alarm id"); return; }
        synchronized (RestAlarmReceiver.class) { RestAlarmReceiver.cancel(getContext(), id); }
        call.resolve();
    }
}
