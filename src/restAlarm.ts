import type { Data } from "./model.ts";

export type AlarmResult = "scheduled" | "foreground" | "off" | "ready";
export type AlarmPort = {
  cancel: () => Promise<void>;
  schedule: (data: Data) => Promise<"scheduled" | "foreground">;
};

/** Dispatch immediately. Capacitor's native handler and the native store serialize mutations.
 * Never wait for an earlier JS promise: a paused WebView may not receive that reply yet.
 */
export function createRestAlarmScheduler(port: AlarmPort, now = Date.now) {
  return async (data: Data): Promise<AlarmResult> => {
    const timer = data.timer;
    if (!data.settings.notifications || !timer || timer.phase === "work" ||
        (timer.phase === "ready" && (timer.deadline > now() || timer.deadline === timer.started))) {
      await port.cancel();
      return "off";
    }
    // Natural expiry remains in the tray; native service/receiver handle it independently.
    if (timer.phase !== "rest" || timer.deadline <= now()) return "ready";
    return port.schedule(data);
  };
}
