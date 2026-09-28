import type { Data } from "./model.ts";

export type AlarmResult = "scheduled" | "needsExact" | "off" | "ready" | "denied";
export type AlarmPort = {
  cancel: () => Promise<void>;
  clearDelivered: () => Promise<void>;
  permission: () => Promise<{ display: boolean; exact: boolean }>;
  prepare: (settings: Data["settings"]) => Promise<string>;
  schedule: (data: Data, channel: string) => Promise<void>;
};

/** Latest change wins, including while an earlier native plugin call is pending. */
export function createRestAlarmScheduler(port: AlarmPort, now = Date.now) {
  let revision = 0,
    queue: Promise<unknown> = Promise.resolve();
  return (data: Data): Promise<AlarmResult> => {
    const current = ++revision;
    const operation = queue
      .catch(() => {})
      .then(async (): Promise<AlarmResult> => {
        if (current !== revision) return "off";
        const timer = data.timer;
        if (
          !data.settings.notifications ||
          !timer ||
          timer.phase === "work" ||
          (timer.phase === "ready" && timer.deadline > now())
        ) {
          await port.cancel();
          await port.clearDelivered();
          return "off";
        }
        // A naturally completed alarm must stay in the system notification tray.
        if (timer.phase !== "rest" || timer.deadline <= now()) return "ready";
        const status = await port.permission();
        if (!status.display) {
          await port.cancel();
          return "denied";
        }
        if (!status.exact) {
          await port.cancel();
          return "needsExact";
        }
        const channel = await port.prepare(data.settings);
        if (current !== revision) return "off";
        await port.cancel();
        if (current !== revision || timer.deadline <= now()) return "ready";
        await port.schedule(data, channel);
        return "scheduled";
      });
    queue = operation;
    return operation;
  };
}
