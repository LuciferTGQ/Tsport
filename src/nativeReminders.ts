import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { App } from "@capacitor/app";
import { createRestAlarmScheduler } from "./restAlarm";
import type { Data } from "./model";
import { validReminderTarget, type ReminderTarget } from "./reminders";

export const isAndroid = Capacitor.getPlatform() === "android";
const REST_ID = 73101,
  TEST_ID = 73102;
const RestAlarm = registerPlugin<{
  schedule(options: {
    id: number;
    deadline: number;
    sound: boolean;
    vibration: boolean;
    name: string;
    title: string;
    body: string;
    date: string;
    exerciseId: string;
  }): Promise<{ status: "scheduled" | "foreground" }>;
  cancel(options: { id: number }): Promise<void>;
  status(): Promise<NativeDiagnostics>;
  openSettings(options: { page: "app" | "battery" | "notifications" }): Promise<void>;
  addListener(event: "alarmOpened", listener: (target: ReminderTarget) => void): Promise<PluginListenerHandle>;
}>("RestAlarm");
export type NativeStatus = { display: boolean; exact: boolean };
export async function nativeReminderStatus(): Promise<NativeStatus> {
  const [permission, exact] = await Promise.all([
    LocalNotifications.checkPermissions(),
    LocalNotifications.checkExactNotificationSetting(),
  ]);
  return {
    display: permission.display === "granted",
    exact: exact.exact_alarm === "granted",
  };
}
export async function requestNativeNotifications() {
  const status = await LocalNotifications.requestPermissions();
  return status.display === "granted";
}
export async function openExactAlarmSettings() {
  await LocalNotifications.changeExactNotificationSetting();
}

export type NativeDiagnostics = {
  version: string; device: string; serviceRunning: boolean; activeTimers: number;
  display: boolean; exact: boolean; batteryUnrestricted: boolean; events: string;
};
export const readNativeDiagnostics = () => RestAlarm.status();
export const openNativeSettings = (page: "app" | "battery" | "notifications") => RestAlarm.openSettings({ page });
export const cancelNativeTest = () => RestAlarm.cancel({ id: TEST_ID });

export const syncNativeReminder = createRestAlarmScheduler({
  cancel: () => RestAlarm.cancel({ id: REST_ID }),
  schedule: async (data) => {
    const timer = data.timer!;
    const exercise = data.days[timer.date]?.exercises.find((e) => e.id === timer.exerciseId);
    const result = await RestAlarm.schedule({
      id: REST_ID, deadline: timer.deadline,
      sound: data.settings.sound, vibration: data.settings.vibration !== false,
      title: timer.kind === "exercise" ? "动作间休息结束 · Tsport" : "休息结束 · Tsport",
      body: `${exercise?.name ?? "本组训练"} · 点击返回，准备好后再开始。`,
      name: exercise?.name ?? "训练休息",
      date: timer.date, exerciseId: timer.exerciseId,
    });
    return result.status;
  },
});

export async function testNativeReminder(target: ReminderTarget, settings: Data["settings"]) {
  // Dispatch immediately; backgrounding during a JS permission/channel await must not lose the timer.
  await RestAlarm.schedule({
    id: TEST_ID, deadline: Date.now() + 30000,
    title: "Tsport · 后台测试提醒", body: "原生后台计时已到点，点击返回训练。",
    name: "30 秒后台测试 · 可切换应用或锁屏",
    sound: settings.sound, vibration: settings.vibration !== false, ...target,
  });
}

export function listenNativeReminders(
  open: (target: ReminderTarget | null) => void,
  refresh: () => void,
) {
  const handles = [
    RestAlarm.addListener("alarmOpened", (target) => {
      open(validReminderTarget(target) ? target : null);
      refresh();
    }),
    LocalNotifications.addListener(
      "localNotificationActionPerformed",
      (event) => {
        open(
          validReminderTarget(event.notification.extra)
            ? event.notification.extra
            : null,
        );
        refresh();
      },
    ),
    LocalNotifications.addListener("localNotificationReceived", () =>
      refresh(),
    ),
    App.addListener("appStateChange", (event) => {
      if (event.isActive) refresh();
    }),
  ];
  return () => {
    handles.forEach((handle) => void handle.then((h) => h.remove()));
  };
}
