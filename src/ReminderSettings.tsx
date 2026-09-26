import { useEffect, useState } from "react";
import { Bell, Vibrate } from "lucide-react";
import type { Data } from "./model";
import {
  reminderPermission,
  requestReminderPermission,
  showRestNotification,
  type ReminderTarget,
} from "./reminders";

export default function ReminderSettings({
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
  const [permission, setPermission] = useState(reminderPermission);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => setPermission(reminderPermission());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const enabled = !!settings.notifications && permission === "granted";
  const descriptions = {
    granted: enabled
      ? "已开启。系统允许时，到点显示通知；点击返回训练。"
      : "通知权限已允许，打开开关即可使用。",
    default: "首次开启会请求浏览器通知权限，请选择允许。",
    denied:
      "通知已被浏览器阻止。请在地址栏的网站设置中允许通知，再回到这里开启。",
    insecure:
      "当前地址无法使用系统通知。手机请通过 HTTPS 访问；电脑可使用 localhost。",
    unsupported:
      "当前浏览器不支持系统通知。iPhone 请先将 HTTPS 网页添加到主屏幕，再从主屏幕打开。",
  };
  async function enable() {
    if (enabled) {
      onChange({ notifications: false });
      return;
    }
    setBusy(true);
    try {
      const result = await requestReminderPermission();
      setPermission(result);
      onChange({ notifications: result === "granted" });
      if (result === "granted")
        notify("休息结束通知已开启，可以发送测试提醒。");
      else notify("尚未开启系统通知，页面内提醒仍可使用。");
    } catch {
      notify("通知服务未能启动，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="reminder-settings">
      <label className="switch-row">
        <span>
          <Bell size={17} /> 休息结束系统通知
        </span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={
            busy || permission === "insecure" || permission === "unsupported"
          }
          onChange={() => void enable()}
        />
      </label>
      <p className="reminder-description" role="status">
        {descriptions[permission]}
      </p>
      <label className="switch-row">
        <span>
          <Vibrate size={17} /> 震动提醒（设备支持时）
        </span>
        <input
          type="checkbox"
          checked={settings.vibration !== false}
          onChange={(e) => onChange({ vibration: e.target.checked })}
        />
      </label>
      <button
        className="secondary wide"
        disabled={!enabled || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const sent = await showRestNotification(
              target,
              "",
              settings.vibration !== false,
              () => true,
              true,
            );
            notify(
              sent
                ? "测试通知已提交；若未出现，请检查系统通知或勿扰设置。"
                : "通知权限已改变，请重新开启。",
            );
          } catch {
            notify("发送失败，请检查浏览器通知权限后重试。");
          } finally {
            setBusy(false);
            setPermission(reminderPermission());
          }
        }}
      >
        <Bell size={17} /> 发送测试提醒
      </button>
      <p className="reminder-description">
        切后台后若浏览器仍在运行，会发送通知。手机冻结网页、关闭页面或锁屏时，提醒可能延迟；此开关不会让网页获得原生闹钟能力。声音和震动也受系统勿扰设置影响。
      </p>
    </div>
  );
}
