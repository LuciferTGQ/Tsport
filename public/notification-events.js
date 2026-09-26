// Notification clicks only focus/navigate; they never start a set.
self.addEventListener("notificationclick", (event) => {
  if (!event.notification.tag.startsWith("tsport-")) return;
  event.notification.close();
  const value = event.notification.data;
  const valid =
    value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    typeof value.exerciseId === "string" &&
    value.exerciseId.length <= 200;
  const target = valid
    ? { date: value.date, exerciseId: value.exerciseId }
    : null;
  const url = new URL("/", self.location.origin);
  if (target) {
    url.searchParams.set("training", target.date);
    url.searchParams.set("exercise", target.exerciseId);
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const candidates = windows.filter(
        (client) =>
          new URL(client.url).origin === self.location.origin &&
          new URL(client.url).pathname === "/",
      );
      candidates.sort((a, b) => Number(b.focused) - Number(a.focused));
      for (const client of candidates) {
        try {
          await client.focus();
          client.postMessage({ type: "TSPORT_OPEN_TRAINING", target });
          return;
        } catch {
          /* Try another window, then open one. */
        }
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
