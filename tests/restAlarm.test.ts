import { test } from "node:test";
import assert from "node:assert/strict";
import { createRestAlarmScheduler, type AlarmPort } from "../src/restAlarm.ts";
import { initialData, samplePlan, type Data } from "../src/model.ts";

function rest(): Data {
  const d = initialData();
  d.settings.notifications = true;
  d.days["2026-09-26"] = samplePlan(120);
  d.timer = {
    phase: "rest",
    date: "2026-09-26",
    exerciseId: d.days["2026-09-26"].exercises[0].id,
    started: 0,
    deadline: 120000,
  };
  return d;
}
function fixture() {
  const events: string[] = [];
  const port: AlarmPort = {
    cancel: async () => {
      events.push("cancel");
    },
    clearDelivered: async () => {
      events.push("clear");
    },
    permission: async () => ({ display: true, exact: true }),
    prepare: async () => "channel",
    schedule: async (d) => {
      events.push(`schedule:${d.timer!.deadline}`);
    },
  };
  return { events, port, sync: createRestAlarmScheduler(port, () => 1000) };
}
test("休息开始即安排原生通知，+30 秒替换原通知，跳过会取消", async () => {
  const { sync, events } = fixture();
  const d = rest();
  assert.equal(await sync(d), "scheduled");
  const later = { ...d, timer: { ...d.timer!, deadline: 150000 } };
  await sync(later);
  await sync({ ...later, timer: { ...later.timer!, phase: "ready" } });
  assert.deepEqual(events, [
    "cancel",
    "schedule:120000",
    "cancel",
    "schedule:150000",
    "cancel",
    "clear",
  ]);
});
test("自然到点不清除系统通知，开始下一组才清除", async () => {
  const { sync, events } = fixture();
  const d = rest();
  await sync({ ...d, timer: { ...d.timer!, phase: "ready", deadline: 500 } });
  assert.deepEqual(events, []);
  await sync({ ...d, timer: { ...d.timer!, phase: "work" } });
  assert.deepEqual(events, ["cancel", "clear"]);
});
test("异步安排期间跳过或关闭，不留下过期闹钟", async () => {
  const { port, events } = fixture();
  let release!: () => void;
  port.prepare = () =>
    new Promise((resolve) => {
      release = () => resolve("channel");
    });
  const sync = createRestAlarmScheduler(port, () => 1000);
  const d = rest(),
    first = sync(d);
  while (!release) await Promise.resolve();
  const cancel = sync({ ...d, timer: null });
  release();
  await Promise.all([first, cancel]);
  assert.deepEqual(events, ["cancel", "clear"]);
});
test("权限不足不伪报准时：允许通知但无精确权限返回延迟状态，拒绝通知则取消", async () => {
  const { port, events } = fixture();
  port.permission = async () => ({ display: true, exact: false });
  const sync = createRestAlarmScheduler(port, () => 1000);
  assert.equal(await sync(rest()), "inexact");
  port.permission = async () => ({ display: false, exact: false });
  assert.equal(await sync(rest()), "denied");
  assert.deepEqual(events, ["cancel", "schedule:120000", "cancel"]);
});
test("安排失败后仍可处理后续取消，不会卡死队列", async () => {
  const { port, events } = fixture();
  port.schedule = async () => {
    throw Error("native failure");
  };
  const sync = createRestAlarmScheduler(port, () => 1000);
  await assert.rejects(sync(rest()));
  await sync({ ...rest(), timer: null });
  assert.deepEqual(events, ["cancel", "cancel", "clear"]);
});
