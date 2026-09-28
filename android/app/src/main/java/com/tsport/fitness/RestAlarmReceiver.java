package com.tsport.fitness;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;

/** Posts directly from Android. No JS callback, running Activity or network is required. */
public class RestAlarmReceiver extends BroadcastReceiver {
    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("tsport-rest-alarms", Context.MODE_PRIVATE);
    }

    static Intent alarmIntent(Context context, int id) {
        return new Intent(context, RestAlarmReceiver.class)
            .setAction("com.tsport.fitness.REST_" + id).putExtra("id", id);
    }

    static PendingIntent openIntent(Context context, int id, Intent source) {
        Intent open = new Intent(context, MainActivity.class)
            .setAction("com.tsport.fitness.OPEN_REST_" + id)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("tsportAlarm", true)
            .putExtra("date", source.getStringExtra("date"))
            .putExtra("exerciseId", source.getStringExtra("exerciseId"));
        return PendingIntent.getActivity(context, id, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void cancel(Context context, int id) {
        preferences(context).edit().remove("alarm-" + id).commit();
        PendingIntent pending = PendingIntent.getBroadcast(context, id, alarmIntent(context, id),
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (pending != null) {
            ((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).cancel(pending);
            pending.cancel();
        }
    }

    @Override public void onReceive(Context context, Intent intent) {
        synchronized (RestAlarmReceiver.class) {
            int id = intent.getIntExtra("id", 0);
            String token = intent.getStringExtra("token");
            // Reject old broadcasts already in flight when a rest is extended or cancelled.
            if (token == null || !token.equals(preferences(context).getString("alarm-" + id, null))) return;
            preferences(context).edit().remove("alarm-" + id).commit();
            Notification notification = new Notification.Builder(context, intent.getStringExtra("channelId"))
                .setSmallIcon(R.drawable.ic_stat_training)
                .setColor(Color.rgb(23, 77, 62))
                .setContentTitle(intent.getStringExtra("title"))
                .setContentText(intent.getStringExtra("body"))
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(openIntent(context, id, intent))
                .setAutoCancel(true).build();
            ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(id, notification);
        }
    }
}
