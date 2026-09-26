import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { App } from "@capacitor/app";
import { createRestAlarmScheduler } from "./restAlarm";
import type { Data } from "./model";
import { validReminderTarget, type ReminderTarget } from "./reminders";

export const isAndroid = Capacitor.getPlatform() === "android";
const REST_ID = 73101,
  TEST_ID = 73102;
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

async function channel(settings: Data["settings"]) {
  const vibration = settings.vibration !== false;
  const id = `tsport-rest-${settings.sound ? "sound" : "quiet"}-${vibration ? "vibrate" : "still"}-v1`;
  // A bundled silent WAV keeps the notification high-priority while respecting the sound switch.
  await LocalNotifications.createChannel({
    id,
    name: `组间休息${settings.sound ? "有声" : "静音"}${vibration ? "震动" : ""}`,
    description: "训练组间休息结束提醒",
    importance: 4,
    visibility: 1,
    vibration,
    sound: settings.sound ? "rest_beep.wav" : "silence.wav",
  });
  return id;
}

export const syncNativeReminder = createRestAlarmScheduler({
  cancel: () => LocalNotifications.cancel({ notifications: [{ id: REST_ID }] }),
  clearDelivered: () =>
    LocalNotifications.removeDeliveredNotificationsById({ ids: [REST_ID] }),
  permission: nativeReminderStatus,
  prepare: channel,
  schedule: async (data, channelId, exact) => {
    const timer = data.timer!;
    const exercise = data.days[timer.date]?.exercises.find(
      (e) => e.id === timer.exerciseId,
    );
    await LocalNotifications.schedule({
      notifications: [
        {
          id: REST_ID,
          title: "休息结束 · Tsport",
          body: `${exercise?.name ?? "本组训练"} · 点击返回，准备好后再开始下一组。`,
          channelId,
          smallIcon: "ic_stat_training",
          iconColor: "#174d3e",
          autoCancel: true,
          sound: data.settings.sound ? "rest_beep.wav" : "silence.wav",
          schedule: { at: new Date(timer.deadline), allowWhileIdle: true },
          isExactNotification: exact,
          extra: { date: timer.date, exerciseId: timer.exerciseId },
        },
      ],
    });
  },
});

export async function testNativeReminder(
  target: ReminderTarget,
  settings: Data["settings"],
) {
  const status = await nativeReminderStatus();
  if (!status.display) throw new Error("请先允许通知权限");
  await LocalNotifications.schedule({
    notifications: [
      {
        id: TEST_ID,
        title: "Tsport · 测试提醒",
        body: "这是一条 Android 系统通知。点击返回训练。",
        channelId: await channel(settings),
        smallIcon: "ic_stat_training",
        autoCancel: true,
        extra: target,
      },
    ],
  });
}

export function listenNativeReminders(
  open: (target: ReminderTarget | null) => void,
  refresh: () => void,
) {
  const handles = [
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
