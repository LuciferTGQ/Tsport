package com.tsport.fitness;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(RestAlarmPlugin.class);
        super.onCreate(state);
    }
}
