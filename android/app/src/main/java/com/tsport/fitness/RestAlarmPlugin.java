package com.tsport.fitness;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.util.concurrent.atomic.AtomicBoolean;

/** One bridge command performs all native setup; no JS permission/channel/cancel round trips. */
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
        JSONObject alarm;
        try {
            alarm = RestAlarmStore.schedule(getContext(), call.getData());
        } catch (Exception error) {
            RestAlarmStore.event(getContext(), "schedule failed " + error.getClass().getSimpleName());
            call.reject(error.getMessage(), error); return;
        }
        int id = alarm.optInt("id");
        String token = alarm.optString("token");
        AtomicBoolean answered = new AtomicBoolean();
        Handler main = new Handler(Looper.getMainLooper());
        Runnable timeout = () -> {
            if (!answered.compareAndSet(false, true)) return;
            cancelIfCurrent(id, token);
            call.reject("后台计时服务启动超时，请查看后台计时状态");
        };
        ResultReceiver reply = new ResultReceiver(main) {
            @Override protected void onReceiveResult(int code, Bundle result) {
                if (!answered.compareAndSet(false, true)) return;
                main.removeCallbacks(timeout);
                if (code == 1) {
                    JSObject response = new JSObject();
                    response.put("status", alarm.optBoolean("exact") ? "scheduled" : "foreground");
                    call.resolve(response);
                } else {
                    cancelIfCurrent(id, token);
                    call.reject("后台服务启动失败：" + result.getString("error", "未知原因"));
                }
            }
        };
        main.postDelayed(timeout, 8000);
        try {
            getContext().startForegroundService(new Intent(getContext(), RestTimerService.class)
                .putExtra("payload", alarm.toString()).putExtra("reply", reply));
        } catch (Exception error) {
            main.removeCallbacks(timeout);
            if (answered.compareAndSet(false, true)) {
                cancelIfCurrent(id, token);
                call.reject("无法启动常驻倒计时：" + error.getMessage(), error);
            }
        }
    }

    private void cancelIfCurrent(int id, String token) {
        synchronized (RestAlarmStore.class) {
            JSONObject current = RestAlarmStore.read(getContext(), id);
            if (current != null && token.equals(current.optString("token"))) RestAlarmStore.cancel(getContext(), id);
        }
    }

    @PluginMethod public void cancel(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null || (id != RestAlarmStore.REST && id != RestAlarmStore.TEST)) { call.reject("Invalid alarm id"); return; }
        RestAlarmStore.cancel(getContext(), id);
        call.resolve();
    }

    @PluginMethod public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("version", BuildConfig.VERSION_NAME);
        result.put("device", Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE + " / API " + Build.VERSION.SDK_INT);
        result.put("serviceRunning", RestTimerService.running());
        result.put("activeTimers", RestAlarmStore.active(getContext()).size());
        result.put("display", getContext().getSystemService(NotificationManager.class).areNotificationsEnabled());
        result.put("exact", Build.VERSION.SDK_INT < 31 || getContext().getSystemService(AlarmManager.class).canScheduleExactAlarms());
        result.put("batteryUnrestricted", getContext().getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getContext().getPackageName()));
        result.put("events", RestAlarmStore.prefs(getContext()).getString("events", "尚无原生计时记录"));
        call.resolve(result);
    }

    @PluginMethod public void openSettings(PluginCall call) {
        String page = call.getString("page", "app");
        Intent intent;
        if (page.equals("battery")) intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        else if (page.equals("notifications")) intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        else intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        try { getActivity().startActivity(intent); call.resolve(); }
        catch (Exception error) { call.reject("无法打开此系统设置", error); }
    }
}
