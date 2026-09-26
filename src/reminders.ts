export type ReminderTarget = { date: string; exerciseId: string };
export type ReminderPermission =
  NotificationPermission | "unsupported" | "insecure";

export function reminderPermission(): ReminderPermission {
  if (!window.isSecureContext) return "insecure";
  if (!("Notification" in window) || !("serviceWorker" in navigator))
    return "unsupported";
  return Notification.permission;
}

let registrationPromise: Promise<ServiceWorkerRegistration> | undefined;
export function registerReminderWorker() {
  if (!registrationPromise) {
    registrationPromise = (async () => {
      await navigator.serviceWorker.register(
        import.meta.env.DEV ? "/sw.js?dev=1" : "/sw.js",
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("通知服务启动超时，请重试。")),
              10000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    })().catch((error) => {
      registrationPromise = undefined;
      throw error;
    });
  }
  return registrationPromise;
}

export async function requestReminderPermission() {
  const current = reminderPermission();
  if (
    current === "unsupported" ||
    current === "insecure" ||
    current === "denied"
  )
    return current;
  // Permission requests must run directly from the user's button click.
  const result =
    current === "granted" ? current : await Notification.requestPermission();
  if (result === "granted") await registerReminderWorker();
  return result;
}

export async function showRestNotification(
  target: ReminderTarget,
  name: string,
  vibration: boolean,
  isCurrent = () => true,
  test = false,
) {
  if (reminderPermission() !== "granted") return false;
  const registration = await registerReminderWorker();
  if (!isCurrent()) return false;
  const options: NotificationOptions & {
    vibrate?: number[];
    renotify: boolean;
  } = {
    body: test
      ? "点击这条通知返回 Tsport。正式休息结束时会使用同样的提醒。"
      : `${name} · 准备好后再开始下一组。点击返回训练。`,
    icon: "/icon-192.png",
    tag: test ? "tsport-test" : "tsport-rest",
    renotify: true,
    requireInteraction: true,
    data: target,
    ...(vibration ? { vibrate: [250, 120, 250, 120, 400] } : { vibrate: [] }),
  };
  await registration.showNotification(
    test ? "Tsport · 测试提醒" : "休息结束 · Tsport",
    options,
  );
  if (!isCurrent()) await closeRestNotifications();
  return true;
}

export async function closeRestNotifications() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const notifications = await registration?.getNotifications({
      tag: "tsport-rest",
    });
    notifications?.forEach((notification) => notification.close());
  } catch {
    /* Revoked permission must not interrupt training. */
  }
}

export function validReminderTarget(value: unknown): value is ReminderTarget {
  if (!value || typeof value !== "object") return false;
  const v = value as ReminderTarget;
  return (
    typeof v.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.date) &&
    typeof v.exerciseId === "string" &&
    v.exerciseId.length <= 200
  );
}
