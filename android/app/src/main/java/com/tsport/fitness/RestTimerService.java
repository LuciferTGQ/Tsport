package com.tsport.fitness;

import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.*;
import org.json.JSONObject;
import java.util.List;

/** Exists only during user-started rest timers. Neither ticking nor expiry uses the WebView. */
public class RestTimerService extends Service {
    private static volatile RestTimerService instance;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private int lastStartId;
    private final Runnable tick = this::update;

    static boolean running() { return instance != null; }
    static void refreshIfRunning() {
        RestTimerService service = instance;
        if (service != null) service.handler.post(service.tick);
    }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Tsport:restTimer");
        wakeLock.setReferenceCounted(false);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        lastStartId = startId;
        ResultReceiver reply = intent == null ? null : intent.getParcelableExtra("reply");
        try {
            // Publish first, even for a just-expired timer, to fulfil startForegroundService's contract.
            List<JSONObject> alarms = RestAlarmStore.active(this);
            JSONObject first = alarms.isEmpty() ? null : alarms.get(0);
            if (first == null) {
                // A cancel can race with service startup. Use the original payload for a moment.
                String payload = intent == null ? null : intent.getStringExtra("payload");
                if (payload != null) first = new JSONObject(payload);
            }
            if (first != null) {
                if (Build.VERSION.SDK_INT >= 34) startForeground(RestAlarmStore.ONGOING, RestAlarmStore.countdown(this, first), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                else startForeground(RestAlarmStore.ONGOING, RestAlarmStore.countdown(this, first));
            }
            RestAlarmStore.event(this, "foreground service started");
            update();
            if (reply != null) reply.send(1, Bundle.EMPTY);
        } catch (Exception error) {
            RestAlarmStore.event(this, "service failed " + error.getClass().getSimpleName());
            if (reply != null) {
                Bundle result = new Bundle(); result.putString("error", error.getMessage()); reply.send(0, result);
            }
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelfResult(lastStartId);
        }
        return START_NOT_STICKY;
    }

    private void update() {
        handler.removeCallbacks(tick);
        List<JSONObject> alarms = RestAlarmStore.active(this);
        for (JSONObject alarm : alarms) {
            if (RestAlarmStore.remaining(alarm) <= 0)
                RestAlarmStore.fire(this, alarm.optInt("id"), alarm.optString("token"), "service");
        }
        alarms = RestAlarmStore.active(this);
        if (alarms.isEmpty()) {
            if (wakeLock.isHeld()) wakeLock.release();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelfResult(lastStartId);
            return;
        }
        JSONObject first = alarms.get(0);
        long remaining = RestAlarmStore.remaining(first);
        // The system notification draws its own seconds; no per-second JS/native UI work is needed.
        getSystemService(android.app.NotificationManager.class).notify(RestAlarmStore.ONGOING, RestAlarmStore.countdown(this, first));
        if (wakeLock.isHeld()) wakeLock.release();
        wakeLock.acquire(Math.max(1000, remaining + 5000));
        handler.postDelayed(tick, Math.max(1, remaining));
    }

    @Override public void onDestroy() {
        if (instance == this) instance = null;
        handler.removeCallbacksAndMessages(null);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        RestAlarmStore.event(this, "foreground service stopped");
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
