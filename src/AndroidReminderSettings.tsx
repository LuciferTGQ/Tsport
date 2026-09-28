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
  readNativeDiagnostics,
  openNativeSettings,
  cancelNativeTest,
  type NativeDiagnostics,
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
  const [diagnostics, setDiagnostics] = useState<NativeDiagnostics | null>(null);
  const inspect = async () => {
    try { setDiagnostics(await readNativeDiagnostics()); }
    catch (error) { notify(`无法读取原生状态：${error instanceof Error ? error.message : "请确认已安装新版 APK"}`); }
  };
  const systemSettings = async (page: "battery" | "notifications") => {
    try { await openNativeSettings(page); }
    catch { notify("无法打开设置，请在手机设置中搜索 Tsport。"); }
  };
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
              void cancelNativeTest();
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
        {settings.notifications && status.display
          ? "休息开始后，通知栏会出现常驻倒计时；原生服务负责到点提醒，切换应用不依赖页面计时。"
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
            : "常驻倒计时仍可运行；建议允许“闹钟与提醒”，为锁屏或服务被清理时增加系统闹钟保障。"}
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
        disabled={!status.display || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await testNativeReminder(target, settings);
            await inspect();
            notify("常驻倒计时已启动，请下拉通知栏确认，再切到其他应用等待 30 秒。");
          } catch (error) {
            notify(`后台测试未启动：${error instanceof Error ? error.message : "请检查原生状态"}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Bell size={17} /> 30 秒后测试后台提醒
      </button>
      <button className="secondary wide" onClick={async () => { await cancelNativeTest(); await inspect(); }}>取消后台测试</button>
      <button className="secondary wide" onClick={inspect}>检查后台计时状态</button>
      {diagnostics && (
        <div className="native-diagnostics">
          <p>Tsport {diagnostics.version} · {diagnostics.device}</p>
          <p>原生计时服务：{diagnostics.serviceRunning ? "正在运行" : "未运行"} · 待完成计时：{diagnostics.activeTimers}</p>
          <p>通知：{diagnostics.display ? "允许" : "未允许"} · 准时闹钟：{diagnostics.exact ? "允许" : "未允许"}</p>
          <p>系统电池优化：{diagnostics.batteryUnrestricted ? "已豁免" : "未豁免（不代表服务一定被限制）"}</p>
          <details><summary>查看原生运行记录</summary><pre>{diagnostics.events}</pre></details>
        </div>
      )}
      <button className="secondary wide" onClick={() => systemSettings("notifications")}>打开系统通知设置</button>
      <button className="secondary wide" onClick={() => systemSettings("battery")}>打开系统电池优化设置</button>
      <p className="reminder-description">
        iQOO / vivo：如后台测试仍无提醒，请检查系统中 Tsport 的后台耗电管理是否允许后台运行。
        下拉通知栏应能看到倒计时；是否显示顶部横幅取决于通知设置。强行停止会终止计时。
      </p>
    </div>
  );
}
