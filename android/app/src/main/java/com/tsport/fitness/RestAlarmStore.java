package com.tsport.fitness;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import org.json.*;
import java.util.*;

/** All mutations, including service and broadcast expiry, share this monitor. */
final class RestAlarmStore {
    static final int REST = 73101, TEST = 73102, ONGOING = 73100;
    static final String COUNTDOWN_CHANNEL = "tsport-countdown-v1";

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("tsport-rest-alarms", Context.MODE_PRIVATE);
    }

    static int boot(Context c) {
        return Settings.Global.getInt(c.getContentResolver(), Settings.Global.BOOT_COUNT, -1);
    }

    static synchronized JSONObject read(Context c, int id) {
        try {
            JSONObject alarm = new JSONObject(prefs(c).getString("timer-" + id, ""));
            if (alarm.getInt("boot") == boot(c)) return alarm;
            prefs(c).edit().remove("timer-" + id).apply();
        } catch (JSONException ignored) { }
        return null;
    }

    static synchronized List<JSONObject> active(Context c) {
        List<JSONObject> alarms = new ArrayList<>();
        for (int id : new int[] { REST, TEST }) {
            JSONObject alarm = read(c, id);
            if (alarm != null) alarms.add(alarm);
        }
        alarms.sort(Comparator.comparingLong(a -> a.optLong("elapsedDeadline")));
        return alarms;
    }

    static long remaining(JSONObject alarm) {
        return alarm.optLong("elapsedDeadline") - SystemClock.elapsedRealtime();
    }

    static synchronized void event(Context c, String text) {
        String previous = prefs(c).getString("events", "");
        String updated = System.currentTimeMillis() + " " + text + "\n" + previous;
        String[] lines = updated.split("\n");
        prefs(c).edit().putString("events", String.join("\n", Arrays.copyOf(lines, Math.min(lines.length, 16)))).apply();
    }

    static String channels(Context c, boolean sound, boolean vibration) {
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        NotificationChannel ongoing = new NotificationChannel(COUNTDOWN_CHANNEL, "休息倒计时（常驻）", NotificationManager.IMPORTANCE_LOW);
        ongoing.setSound(null, null);
        ongoing.enableVibration(false);
        manager.createNotificationChannel(ongoing);
        String id = "tsport-rest-" + sound + "-" + vibration + "-v2";
        NotificationChannel alert = new NotificationChannel(id, "休息结束" + (sound ? " · 声音" : " · 静音") + (vibration ? " · 震动" : ""), NotificationManager.IMPORTANCE_HIGH);
        alert.setVibrationPattern(new long[] { 0, 300, 150, 300 });
        alert.enableVibration(vibration);
        alert.setSound(sound ? Uri.parse("android.resource://" + c.getPackageName() + "/" + R.raw.rest_beep) : null,
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).build());
        manager.createNotificationChannel(alert);
        if (!manager.areNotificationsEnabled() || manager.getNotificationChannel(id).getImportance() == NotificationManager.IMPORTANCE_NONE
            || manager.getNotificationChannel(COUNTDOWN_CHANNEL).getImportance() == NotificationManager.IMPORTANCE_NONE) {
            throw new IllegalStateException("请允许 Tsport 的休息结束和常驻倒计时通知");
        }
        return id;
    }

    static Intent alarmIntent(Context c, int id) {
        return new Intent(c, RestAlarmReceiver.class).setAction("com.tsport.fitness.REST_" + id).putExtra("id", id);
    }

    static PendingIntent openIntent(Context c, JSONObject alarm) {
        int id = alarm.optInt("id");
        Intent open = new Intent(c, MainActivity.class).setAction("com.tsport.fitness.OPEN_REST_" + id)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("tsportAlarm", true).putExtra("date", alarm.optString("date"))
            .putExtra("exerciseId", alarm.optString("exerciseId"));
        return PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void cancelSystemAlarm(Context c, int id) {
        PendingIntent pending = PendingIntent.getBroadcast(c, id, alarmIntent(c, id), PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (pending != null) {
            c.getSystemService(AlarmManager.class).cancel(pending);
            pending.cancel();
        }
    }

    static boolean armSystemAlarm(Context c, JSONObject alarm) {
        AlarmManager manager = c.getSystemService(AlarmManager.class);
        if (Build.VERSION.SDK_INT >= 31 && !manager.canScheduleExactAlarms()) return false;
        Intent intent = alarmIntent(c, alarm.optInt("id")).putExtra("token", alarm.optString("token"));
        PendingIntent pending = PendingIntent.getBroadcast(c, alarm.optInt("id"), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.setAlarmClock(new AlarmManager.AlarmClockInfo(System.currentTimeMillis() + Math.max(100, remaining(alarm)), openIntent(c, alarm)), pending);
        return true;
    }

    static synchronized JSONObject schedule(Context c, JSONObject options) throws JSONException {
        int id = options.getInt("id");
        long deadline = options.getLong("deadline");
        long duration = deadline - System.currentTimeMillis();
        if ((id != REST && id != TEST) || duration <= 0 || duration > 86400000) throw new IllegalArgumentException("休息截止时间无效");
        String channel = channels(c, options.optBoolean("sound", true), options.optBoolean("vibration", true));
        JSONObject alarm = new JSONObject(options.toString());
        alarm.put("channelId", channel).put("token", UUID.randomUUID().toString())
            .put("boot", boot(c)).put("elapsedDeadline", SystemClock.elapsedRealtime() + duration);
        cancelSystemAlarm(c, id);
        if (!prefs(c).edit().remove("alarm-" + id).putString("timer-" + id, alarm.toString()).commit())
            throw new IllegalStateException("无法保存原生计时");
        boolean exact = false;
        try { exact = armSystemAlarm(c, alarm); }
        catch (SecurityException error) { event(c, "exact alarm unavailable"); }
        alarm.put("exact", exact);
        prefs(c).edit().putString("timer-" + id, alarm.toString()).commit();
        event(c, "scheduled id=" + id + " durationMs=" + duration + " exact=" + exact);
        return alarm;
    }

    static synchronized void cancel(Context c, int id) {
        prefs(c).edit().remove("timer-" + id).remove("alarm-" + id).commit();
        cancelSystemAlarm(c, id);
        c.getSystemService(NotificationManager.class).cancel(id);
        event(c, "cancelled id=" + id);
        RestTimerService.refreshIfRunning();
    }

    static Notification.Builder notification(Context c, JSONObject alarm, String channel) {
        return new Notification.Builder(c, channel).setSmallIcon(R.drawable.ic_stat_training)
            .setColor(Color.rgb(23, 77, 62)).setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(openIntent(c, alarm));
    }

    static Notification countdown(Context c, JSONObject alarm) {
        Notification.Builder builder = notification(c, alarm, COUNTDOWN_CHANNEL)
            .setContentTitle(alarm.optInt("id") == TEST ? "后台测试倒计时" : "组间休息倒计时")
            .setContentText(alarm.optString("name", "点击返回训练，到点后手动开始下一组"))
            .setCategory(Notification.CATEGORY_STOPWATCH).setOngoing(true).setOnlyAlertOnce(true)
            .setWhen(System.currentTimeMillis() + Math.max(0, remaining(alarm)))
            .setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true);
        if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return builder.build();
    }

    static synchronized boolean fire(Context c, int id, String token, String source) {
        JSONObject alarm = read(c, id);
        if (alarm == null || !alarm.optString("token").equals(token)) return false;
        if (remaining(alarm) > 0) {
            // A wall-clock change may make the alarm-clock broadcast arrive early.
            if (source.equals("alarm")) {
                try { armSystemAlarm(c, alarm); } catch (SecurityException ignored) { }
            }
            return false;
        }
        prefs(c).edit().remove("timer-" + id).commit();
        cancelSystemAlarm(c, id);
        try {
            Notification alert = notification(c, alarm, alarm.optString("channelId"))
                .setContentTitle(alarm.optString("title", "休息结束 · Tsport"))
                .setContentText(alarm.optString("body", "准备好后再开始下一组。"))
                .setCategory(Notification.CATEGORY_ALARM).setAutoCancel(true).build();
            c.getSystemService(NotificationManager.class).notify(id, alert);
            event(c, "fired id=" + id + " source=" + source + " lateMs=" + Math.max(0, -remaining(alarm)));
        } catch (SecurityException error) { event(c, "notification denied id=" + id); }
        RestTimerService.refreshIfRunning();
        return true;
    }
}
