import { test } from "node:test";
import assert from "node:assert/strict";
import { createRestAlarmScheduler, type AlarmPort } from "../src/restAlarm.ts";
import { initialData, samplePlan, type Data } from "../src/model.ts";

function rest(): Data {
  const d = initialData();
  d.settings.notifications = true;
  d.days["2026-09-26"] = samplePlan(120);
  d.timer = { phase: "rest", date: "2026-09-26", exerciseId: d.days["2026-09-26"].exercises[0].id, started: 0, deadline: 120000 };
  return d;
}
function fixture() {
  const events: string[] = [];
  const port: AlarmPort = {
    cancel: async () => { events.push("cancel"); },
    schedule: async (d) => { events.push(`schedule:${d.timer!.deadline}`); return "scheduled"; },
  };
  return { events, port, sync: createRestAlarmScheduler(port, () => 1000) };
}

test("单次原生调用安排休息和延长；跳过或关闭直接取消", async () => {
  const { sync, events } = fixture(), d = rest();
  assert.equal(await sync(d), "scheduled");
  const later = { ...d, timer: { ...d.timer!, deadline: 150000 } };
  await sync(later);
  await sync({ ...later, timer: { ...later.timer!, phase: "ready" } });
  await sync({ ...later, timer: null });
  assert.deepEqual(events, ["schedule:120000", "schedule:150000", "cancel", "cancel"]);
});

test("自然到点不撤销原生通知，下一组或关闭提醒才取消", async () => {
  const { sync, events } = fixture(), d = rest();
  await sync({ ...d, timer: { ...d.timer!, phase: "ready", deadline: 500 } });
  assert.deepEqual(events, []);
  await sync({ ...d, timer: { ...d.timer!, phase: "work" } });
  assert.deepEqual(events, ["cancel"]);
});

test("动作间休息为零时也取消上一动作尚未到点的通知", async () => {
  const { sync, events } = fixture(), d = rest();
  await sync(d);
  await sync({ ...d, timer: { ...d.timer!, phase: "ready", kind: "exercise", exerciseId: "next", started: 1000, deadline: 1000 } });
  assert.deepEqual(events, ["schedule:120000", "cancel"]);
});

test("启动回执尚未返回时取消，最终不留下后台计时", async () => {
  const { port, events } = fixture();
  let release!: () => void;
  port.schedule = () => new Promise((resolve) => {
    events.push("native-start"); release = () => resolve("scheduled");
  });
  const sync = createRestAlarmScheduler(port, () => 1000), first = sync(rest());
  while (!release) await Promise.resolve();
  const cancel = sync({ ...rest(), timer: null });
  // Even if the original native reply never reaches JS, cancellation has already crossed the bridge.
  assert.deepEqual(events, ["native-start", "cancel"]);
  release();
  await Promise.all([first, cancel]);
  assert.deepEqual(events, ["native-start", "cancel"]);
});

test("上一条启动回执未返回，下一动作仍立即交给原生", async () => {
  const deadlines: number[] = [];
  let release!: () => void;
  const sync = createRestAlarmScheduler({
    cancel: async () => {},
    schedule: (d) => {
      deadlines.push(d.timer!.deadline);
      if (deadlines.length === 1) return new Promise((resolve) => { release = () => resolve("scheduled"); });
      return Promise.resolve("scheduled");
    },
  }, () => 1000);
  const first = sync(rest());
  const next = { ...rest(), timer: { ...rest().timer!, deadline: 150000 } };
  await sync(next);
  assert.deepEqual(deadlines, [120000, 150000]);
  release(); await first;
});

test("无精确权限时由原生返回前台服务状态，启动错误不伪报成功", async () => {
  const { port } = fixture();
  port.schedule = async () => "foreground";
  const sync = createRestAlarmScheduler(port, () => 1000);
  assert.equal(await sync(rest()), "foreground");
  port.schedule = async () => { throw Error("service not started"); };
  await assert.rejects(sync(rest()), /service not started/);
  assert.equal(await sync({ ...rest(), timer: null }), "off");
});

test("动作切换即使截止时间相同，也安排下一动作的新目标", async () => {
  const targets: string[] = [], d = rest();
  const sync = createRestAlarmScheduler({ cancel: async () => {}, schedule: async (data) => {
    targets.push(data.timer!.exerciseId); return "scheduled";
  } }, () => 1000);
  await sync(d);
  const nextId = d.days[d.timer!.date].exercises[1].id;
  await sync({ ...d, timer: { ...d.timer!, kind: "exercise", exerciseId: nextId } });
  assert.deepEqual(targets, [d.timer!.exerciseId, nextId]);
});
