import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialData,
  samplePlan,
  finishSet,
  settleTimer,
  completedSets,
  clonePlan,
  validateData,
  dateKey,
  parseDate,
  migrateData,
  completeExercise,
  advanceExercise,
} from "../src/model.ts";

test("绿色卡片完成动作后进入下一动作休息，下一组只写入下一动作", () => {
  let data = initialData();
  const date = "2026-09-28";
  data.days[date] = samplePlan(20);
  data.settings.exerciseRest = 90;
  const [first, second] = data.days[date].exercises;
  first.sets = 1;
  data.timer = { phase: "work", date, exerciseId: first.id, started: 1000, deadline: 0 };
  data = advanceExercise(finishSet(data, 41000), 42000);
  assert.equal(data.days[date].exercises[0].completed, true);
  assert.deepEqual(data.timer, { phase: "rest", kind: "exercise", date, exerciseId: second.id, started: 42000, deadline: 132000 });
  data = settleTimer(data, 132000);
  assert.equal(data.timer?.phase, "ready");
  data = finishSet({ ...data, timer: { ...data.timer!, phase: "work", started: 150000 } }, 190000);
  assert.equal(data.days[date].exercises[0].records.length, 1);
  assert.equal(data.days[date].exercises[1].records.length, 1);
  assert.equal(data.days[date].exercises[1].records[0].duration, 40);
  assert.equal(data.timer?.kind, "set");
  assert.equal(data.timer?.deadline, 210000);
});

test("最后动作完成收起计时，零秒动作间歇等待手动开始，旧备份默认两分钟", () => {
  const d = initialData(), date = "2026-09-28";
  d.days[date] = samplePlan(0);
  const first = d.days[date].exercises[0];
  first.sets = 1;
  d.timer = { phase: "work", date, exerciseId: first.id, started: 0, deadline: 0 };
  const ended = finishSet(d, 1000);
  delete ended.settings.exerciseRest;
  assert.equal(advanceExercise(ended, 1000).timer?.deadline, 121000);
  ended.settings.exerciseRest = 0;
  assert.equal(advanceExercise(ended, 1000).timer?.phase, "ready");
  ended.days[date].exercises = [ended.days[date].exercises[0]];
  assert.equal(advanceExercise(ended, 1000).timer, null);
});

test("旧记录补上休息标签且迁移幂等，休息日不算运动日", () => {
  const old = initialData();
  old.tags = old.tags.filter((t) => t.id !== "rest");
  old.days["2026-09-26"] = samplePlan(120);
  const updated = migrateData(old);
  assert.equal(updated.tags.filter((t) => t.name === "休息").length, 1);
  assert.equal(migrateData(updated), updated);
  assert.equal(updated.days, old.days);
  assert.equal(completedSets({ tags: ["rest"], exercises: [], note: "" }), 0);
  assert.ok(validateData(updated));
});

test("达标后主动完成动作，取消本动作休息并保留历史；模板不带完成状态", () => {
  const d = initialData(), date = "2026-09-26";
  d.days[date] = samplePlan(120);
  const e = d.days[date].exercises[0];
  e.sets = 1;
  assert.equal(completeExercise(d, date, e.id), d);
  d.timer = { phase: "work", date, exerciseId: e.id, started: 0, deadline: 0 };
  const ended = finishSet(d, 40000);
  const completed = completeExercise(ended, date, e.id);
  assert.equal(completed.timer, null);
  assert.equal(completed.days[date].exercises[0].completed, true);
  assert.deepEqual(completed.days[date].exercises[0].records, ended.days[date].exercises[0].records);
  assert.equal(clonePlan(completed.days[date]).exercises[0].completed, false);
  assert.ok(validateData(JSON.parse(JSON.stringify(completed))));
  const working = { ...completed, timer: d.timer };
  assert.equal(completeExercise(working, date, e.id), working);
  const another = { ...ended, timer: { ...ended.timer!, exerciseId: d.days[date].exercises[1].id } };
  assert.equal(completeExercise(another, date, e.id).timer, another.timer);
});

test("结束一组保留实际耗时，自动进入休息，重复结束不会产生重复记录", () => {
  const d = initialData();
  d.days["2026-09-26"] = samplePlan(120);
  const e = d.days["2026-09-26"].exercises[0];
  d.timer = {
    phase: "work",
    date: "2026-09-26",
    exerciseId: e.id,
    started: 1000,
    deadline: 0,
  };
  const ended = finishSet(d, 46000);
  assert.equal(ended.days["2026-09-26"].exercises[0].records[0].duration, 45);
  assert.equal(ended.timer?.phase, "rest");
  assert.equal(ended.timer?.deadline, 166000);
  assert.equal(completedSets(finishSet(ended, 47000).days["2026-09-26"]), 1);
  assert.equal(settleTimer(ended, 165999).timer?.phase, "rest");
  assert.equal(settleTimer(ended, 166000).timer?.phase, "ready");
  assert.equal(settleTimer(ended, 999999).timer?.phase, "ready");
});
test("零秒休息直接等待，刷新恢复不会自动开始下一组", () => {
  const d = initialData();
  const day = samplePlan(0);
  d.days["2026-09-26"] = day;
  d.timer = {
    phase: "work",
    date: "2026-09-26",
    exerciseId: day.exercises[0].id,
    started: 0,
    deadline: 0,
  };
  const ended = finishSet(d, 1000);
  assert.equal(ended.timer?.phase, "ready");
  const reloaded = JSON.parse(JSON.stringify(ended));
  assert.ok(validateData(reloaded));
  assert.equal(settleTimer(reloaded, 300000).timer?.phase, "ready");
});
test("复制模板仅复制目标，完成组清空且不修改原记录", () => {
  const original = samplePlan(120);
  original.exercises[0].records.push({
    id: "r",
    reps: 8,
    kg: 20,
    duration: 40,
    at: 123,
  });
  const cloned = clonePlan(original);
  assert.equal(completedSets(cloned), 0);
  assert.equal(completedSets(original), 1);
  assert.notEqual(cloned.exercises[0].id, original.exercises[0].id);
  cloned.exercises[0].reps = 10;
  assert.equal(original.exercises[0].records[0].reps, 8);
});
test("导入校验拒绝非法体重、损坏日期、孤立计时与缺失字段", () => {
  const d = initialData();
  assert.ok(validateData(d));
  assert.equal(validateData({ ...d, weights: { "2026-02-30": 72 } }), false);
  assert.equal(validateData({ ...d, weights: { "2026-09-26": -1 } }), false);
  assert.equal(
    validateData({
      ...d,
      timer: {
        phase: "work",
        date: "2026-09-26",
        exerciseId: "missing",
        started: 1,
        deadline: 0,
      },
    }),
    false,
  );
  assert.equal(validateData({ version: 1 }), false);
  assert.equal(validateData(null), false);
});
test("跨年与闰日使用本地日期，不受 UTC 日期偏移影响", () => {
  assert.equal(dateKey(parseDate("2024-02-29")), "2024-02-29");
  const d = parseDate("2026-12-01");
  d.setMonth(d.getMonth() + 1);
  assert.equal(dateKey(d), "2027-01-01");
});
