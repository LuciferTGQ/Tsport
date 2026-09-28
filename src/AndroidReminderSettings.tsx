import { useEffect, useState } from "react";
import { Bell, Timer, Vibrate } from "lucide-react";
import { App } from "@capacitor/app";
import type { Data } from "./model";
import type { ReminderTarget } from "./reminders";
import {
  nativeReminderStatus,
  requestNativeNotifications,
  openExactAlarmSettings,
  testNativeReminder,
  type NativeStatus,
} from "./nativeReminders";

export default function AndroidReminderSettings({
  settings,
  onChange,
  target,
  notify,
}: {
  settings: Data["settings"];
  onChange: (patch: Partial<Data["settings"]>) => void;
  target: ReminderTarget;
  notify: (message: string) => void;
}) {
  const [status, setStatus] = useState<NativeStatus>({
      display: false,
      exact: false,
    }),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => {
      void nativeReminderStatus()
        .then(setStatus)
        .catch(() => notify("读取通知权限失败，请重试。"));
    };
    refresh();
    const listener = App.addListener("appStateChange", (event) => {
      if (event.isActive) refresh();
    });
    return () => {
      void listener.then((l) => l.remove());
    };
  }, []);
  return (
    <div className="reminder-settings">
      <label className="switch-row">
        <span>
          <Bell size={17} /> 休息结束系统通知
        </span>
        <input
          type="checkbox"
          checked={!!settings.notifications && status.display}
          disabled={busy}
          onChange={async () => {
            if (settings.notifications && status.display) {
              onChange({ notifications: false });
              return;
            }
            setBusy(true);
            try {
              const granted = await requestNativeNotifications();
              setStatus(await nativeReminderStatus());
              onChange({ notifications: granted });
              if (!granted)
                notify("请在手机设置 → 应用 → Tsport → 通知中允许通知。");
            } catch {
              notify("通知权限开启失败，请重试。");
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <p className="reminder-description">
        {settings.notifications && status.display && status.exact
          ? "后台提醒已开启。休息开始时交给 Android 闹钟，切到其他应用仍可提醒。"
          : "开启后请允许 Android 通知权限。到点显示通知，点击回到对应训练。"}
      </p>
      <label className="switch-row">
        <span>
          <Vibrate size={17} /> 震动提醒
        </span>
        <input
          type="checkbox"
          checked={settings.vibration !== false}
          onChange={(e) => onChange({ vibration: e.target.checked })}
        />
      </label>
      <div className="alarm-permission">
        <strong>
          <Timer size={17} /> 准时提醒：{status.exact ? "已允许" : "未允许"}
        </strong>
        <p className="reminder-description">
          {status.exact
            ? "休息截止时间由 Android 系统计时。"
            : "后台准时提醒尚未启用，请允许“闹钟与提醒”。"}
        </p>
        {!status.exact && (
          <button
            className="secondary wide"
            onClick={async () => {
              try {
                await openExactAlarmSettings();
                setStatus(await nativeReminderStatus());
              } catch {
                notify("请在手机设置中为 Tsport 允许“闹钟与提醒”。");
              }
            }}
          >
            开启准时提醒权限
          </button>
        )}
      </div>
      <button
        className="secondary wide"
        disabled={!status.display || !status.exact || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await testNativeReminder(target, settings);
            notify("已安排 30 秒后提醒，现在请切到其他应用或锁屏等待。");
          } catch {
            notify("通知发送失败，请检查手机通知设置。");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Bell size={17} /> 30 秒后测试后台提醒
      </button>
      <p className="reminder-description">
        如未弹出横幅，请在手机的 Tsport
        通知设置中允许横幅、声音和震动。勿扰模式、强行停止应用及厂商省电限制仍可能影响提醒。
      </p>
    </div>
  );
}
