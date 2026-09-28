package com.tsport.fitness;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import java.time.Duration;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

/** Executes actual Java service/receiver code without any Activity, WebView, or JS callbacks. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 36)
public class RestTimerTest {
    private Application app;
    private ServiceController<RestTimerService> service;

    @Before public void setup() {
        app = RuntimeEnvironment.getApplication();
        RestAlarmStore.prefs(app).edit().clear().commit();
        shadowOf(app.getSystemService(AlarmManager.class)).setCanScheduleExactAlarms(true);
    }

    @After public void cleanup() {
        if (service != null) service.destroy();
    }

    private JSONObject options(int id, long duration) throws Exception {
        return new JSONObject().put("id", id).put("deadline", System.currentTimeMillis() + duration)
            .put("sound", true).put("vibration", true).put("name", "Test exercise")
            .put("date", "2026-09-28").put("exerciseId", "next-exercise");
    }

    private void start(JSONObject alarm) {
        service = Robolectric.buildService(RestTimerService.class).create();
        service.startCommand(0, 1);
    }

    @Test public void nativeServiceExpiresWithoutActivityOrJavaScript() throws Exception {
        JSONObject alarm = RestAlarmStore.schedule(app, options(RestAlarmStore.REST, 30000));
        start(alarm);
        Notification ongoing = shadowOf(app.getSystemService(NotificationManager.class)).getNotification(RestAlarmStore.ONGOING);
        assertNotNull(ongoing);
        assertTrue(ongoing.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER));
        assertTrue(ongoing.extras.getBoolean(Notification.EXTRA_CHRONOMETER_COUNT_DOWN));
        assertTrue((ongoing.flags & Notification.FLAG_ONGOING_EVENT) != 0);
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(30));
        assertNull(RestAlarmStore.read(app, RestAlarmStore.REST));
        assertNotNull(shadowOf(app.getSystemService(NotificationManager.class)).getNotification(RestAlarmStore.REST));
        assertTrue(RestAlarmStore.prefs(app).getString("events", "").contains("source=service"));
    }

    @Test public void rescheduleAndCancelRejectStaleBroadcasts() throws Exception {
        JSONObject old = RestAlarmStore.schedule(app, options(RestAlarmStore.REST, 10000));
        JSONObject later = RestAlarmStore.schedule(app, options(RestAlarmStore.REST, 40000));
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(11));
        assertFalse(RestAlarmStore.fire(app, RestAlarmStore.REST, old.getString("token"), "alarm"));
        assertNotNull(RestAlarmStore.read(app, RestAlarmStore.REST));
        RestAlarmStore.cancel(app, RestAlarmStore.REST);
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(40));
        assertFalse(RestAlarmStore.fire(app, RestAlarmStore.REST, later.getString("token"), "alarm"));
        assertNull(shadowOf(app.getSystemService(NotificationManager.class)).getNotification(RestAlarmStore.REST));
    }

    @Test public void alarmAndServiceDoNotDeliverTwiceAndTestDoesNotOverwriteRest() throws Exception {
        JSONObject rest = RestAlarmStore.schedule(app, options(RestAlarmStore.REST, 30000));
        RestAlarmStore.schedule(app, options(RestAlarmStore.TEST, 60000));
        start(rest);
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(30));
        assertFalse(RestAlarmStore.fire(app, RestAlarmStore.REST, rest.getString("token"), "alarm"));
        assertNotNull(RestAlarmStore.read(app, RestAlarmStore.TEST));
        assertNotNull(shadowOf(app.getSystemService(NotificationManager.class)).getNotification(RestAlarmStore.ONGOING));
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(30));
        assertTrue(RestAlarmStore.active(app).isEmpty());
        assertNotNull(shadowOf(app.getSystemService(NotificationManager.class)).getNotification(RestAlarmStore.TEST));
    }

    @Test public void foregroundCountdownAlsoWorksWithoutExactAlarmPermission() throws Exception {
        shadowOf(app.getSystemService(AlarmManager.class)).setCanScheduleExactAlarms(false);
        JSONObject alarm = RestAlarmStore.schedule(app, options(RestAlarmStore.REST, 2000));
        assertFalse(alarm.getBoolean("exact"));
        start(alarm);
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2));
        assertNotNull(shadowOf(app.getSystemService(NotificationManager.class)).getNotification(RestAlarmStore.REST));
    }

    @Test public void cancelStopsOngoingCountdownAndNeverAlertsLater() throws Exception {
        JSONObject alarm = RestAlarmStore.schedule(app, options(RestAlarmStore.REST, 30000));
        start(alarm);
        RestAlarmStore.cancel(app, RestAlarmStore.REST);
        shadowOf(Looper.getMainLooper()).idle();
        assertNull(shadowOf(app.getSystemService(NotificationManager.class)).getNotification(RestAlarmStore.ONGOING));
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(31));
        assertNull(shadowOf(app.getSystemService(NotificationManager.class)).getNotification(RestAlarmStore.REST));
    }

    @Test public void receiverWorksWithoutServiceAndTapTargetsOriginalExercise() throws Exception {
        JSONObject alarm = RestAlarmStore.schedule(app, options(RestAlarmStore.REST, 2000));
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2));
        new RestAlarmReceiver().onReceive(app, RestAlarmStore.alarmIntent(app, RestAlarmStore.REST).putExtra("token", alarm.getString("token")));
        Notification alert = shadowOf(app.getSystemService(NotificationManager.class)).getNotification(RestAlarmStore.REST);
        assertNotNull(alert);
        Intent tap = shadowOf(alert.contentIntent).getSavedIntent();
        assertEquals("next-exercise", tap.getStringExtra("exerciseId"));
        assertEquals("2026-09-28", tap.getStringExtra("date"));
        assertTrue(tap.getBooleanExtra("tsportAlarm", false));
        assertTrue(RestAlarmStore.prefs(app).getString("events", "").contains("source=alarm"));
    }

    @Test public void silentNonVibratingChannelHonorsBothSettings() throws Exception {
        JSONObject alarm = RestAlarmStore.schedule(app, options(RestAlarmStore.REST, 30000).put("sound", false).put("vibration", false));
        NotificationChannel channel = app.getSystemService(NotificationManager.class).getNotificationChannel(alarm.getString("channelId"));
        assertNull(channel.getSound());
        assertFalse(channel.shouldVibrate());
    }

    @Test public void cancellationBeforeServiceStartupDoesNotLeaveAnOngoingNotification() throws Exception {
        JSONObject alarm = RestAlarmStore.schedule(app, options(RestAlarmStore.REST, 30000));
        RestAlarmStore.cancel(app, RestAlarmStore.REST);
        service = Robolectric.buildService(RestTimerService.class,
            new Intent(app, RestTimerService.class).putExtra("payload", alarm.toString())).create();
        service.startCommand(0, 1);
        assertTrue(RestAlarmStore.active(app).isEmpty());
        assertNull(shadowOf(app.getSystemService(NotificationManager.class)).getNotification(RestAlarmStore.ONGOING));
    }
}
