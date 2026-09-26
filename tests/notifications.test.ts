import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import { initialData, validateData } from "../src/model.ts";

const source = fs.readFileSync(
  new URL("../public/notification-events.js", import.meta.url),
  "utf8",
);
async function click(windows: unknown[], target: unknown) {
  const opened: string[] = [],
    messages: unknown[] = [];
  let closed = false;
  let listener: (event: unknown) => void = () => {};
  let pending: Promise<void> | undefined;
  const self = {
    location: { origin: "https://tsport.test" },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
    addEventListener: (_type: string, callback: typeof listener) => {
      listener = callback;
    },
  };
  vm.runInNewContext(source, { self, URL });
  listener({
    notification: {
      tag: "tsport-rest",
      data: target,
      close: () => {
        closed = true;
      },
    },
    waitUntil: (p: Promise<void>) => {
      pending = p;
    },
  });
  await pending;
  return { opened, closed, messages };
}
test("点击通知优先唤回已有训练窗口，不打开重复页面、不开始下一组", async () => {
  const messages: any[] = [];
  let focused = 0;
  const result = await click(
    [
      {
        url: "https://tsport.test/",
        focused: false,
        focus: async () => {
          focused++;
        },
        postMessage: (m: unknown) => messages.push(m),
      },
    ],
    { date: "2026-09-26", exerciseId: "bench" },
  );
  assert.equal(focused, 1);
  assert.equal(result.closed, true);
  assert.equal(result.opened.length, 0);
  assert.equal(messages[0].type, "TSPORT_OPEN_TRAINING");
  assert.equal(messages[0].target.exerciseId, "bench");
});
test("窗口已关闭时使用同源训练链接重新打开，忽略外部跳转数据", async () => {
  const result = await click([], {
    date: "2026-09-26",
    exerciseId: "bench & press",
    url: "https://untrusted.example",
  });
  const url = new URL(result.opened[0]);
  assert.equal(url.origin, "https://tsport.test");
  assert.equal(url.searchParams.get("exercise"), "bench & press");
  assert.equal(url.searchParams.get("training"), "2026-09-26");
});
test("无法聚焦窗口时回退到打开训练链接；无效通知目标只打开首页", async () => {
  const result = await click(
    [
      {
        url: "https://tsport.test/",
        focus: async () => {
          throw Error("closed");
        },
      },
    ],
    null,
  );
  assert.equal(result.opened[0], "https://tsport.test/");
});
test("旧备份兼容，新通知和震动偏好必须为布尔值", () => {
  const data = initialData();
  delete data.settings.notifications;
  delete data.settings.vibration;
  assert.ok(validateData(data));
  assert.ok(
    validateData({
      ...data,
      settings: { ...data.settings, notifications: true, vibration: false },
    }),
  );
  assert.equal(
    validateData({
      ...data,
      settings: { ...data.settings, notifications: "yes" },
    }),
    false,
  );
});
