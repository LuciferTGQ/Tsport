package com.tsport.fitness;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarm-clock fallback and foreground service share one idempotent expiry path. */
public class RestAlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        RestAlarmStore.fire(context, intent.getIntExtra("id", 0), intent.getStringExtra("token"), "alarm");
    }
}
