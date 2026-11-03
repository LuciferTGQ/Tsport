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
  reorderExercise,
  weightForSet,
  cloneExercisePlan,
  saveExercisePreset,
} from "../src/model.ts";

test("递增组记录对应的目标重量，加练沿用最后一组，旧动作仍使用统一重量", () => {
  let data = initialData();
  const date = "2026-11-01";
  data.days[date] = samplePlan(0);
  const exercise = data.days[date].exercises[0];
  exercise.kg = 15;
  assert.equal(weightForSet(exercise), 15);
  assert.equal(weightForSet(exercise, 8), 15);
  exercise.targetWeights = [0, 20, 22.5, 25];
  for (let index = 0; index < 5; index++) {
    data = { ...data, timer: { phase: "work", date, exerciseId: exercise.id, started: index * 100000, deadline: 0 } };
    data = finishSet(data, index * 100000 + 40000);
  }
  const trained = data.days[date].exercises[0];
  assert.deepEqual(trained.records.map((r) => r.kg), [0, 20, 22.5, 25, 25]);
  assert.ok(trained.records.every((r) => r.reps === 12 && r.duration === 40));
  assert.equal(exercise.records.length, 0);
  const changed = { ...trained, kg: 30, targetWeights: [5, 25, 27.5, 30] };
  assert.equal(weightForSet(changed), 30);
  assert.deepEqual(changed.records.map((r) => r.kg), [0, 20, 22.5, 25, 25]);
  assert.ok(validateData(JSON.parse(JSON.stringify(data))));
});

test("保存动作只带计划并独立复制每组重量，更新动作库不修改已添加动作", () => {
  const exercise = samplePlan(90).exercises[0];
  exercise.targetWeights = [10, 15, 20, 25];
  exercise.completed = true;
  exercise.records = [{ id: "past", reps: 8, kg: 22.5, duration: 30, at: 1000 }];
  const preset = saveExercisePreset(exercise, "胸");
  const first = cloneExercisePlan(preset.exercise);
  const second = cloneExercisePlan(preset.exercise);
  assert.notEqual(preset.exercise.id, exercise.id);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(preset.exercise.records, []);
  assert.equal(preset.exercise.completed, false);
  assert.equal(preset.exercise.rest, 90);
  assert.equal(preset.exercise.sets, 4);
  assert.equal(preset.exercise.reps, 12);
  first.targetWeights![0] = 40;
  first.records.push({ id: "new", reps: 12, kg: 40, duration: null, at: 2000 });
  assert.deepEqual(preset.exercise.targetWeights, [10, 15, 20, 25]);
  assert.deepEqual(second.targetWeights, [10, 15, 20, 25]);
  const updated = saveExercisePreset({ ...preset.exercise, sets: 2, targetWeights: [30, 35] }, "其他", preset.id);
  assert.equal(updated.id, preset.id);
  assert.equal(updated.category, "其他");
  assert.equal(first.sets, 4);
  assert.equal(second.records.length, 0);
  assert.equal(exercise.records[0].kg, 22.5);
});

test("旧备份兼容，动作库和每组重量在完整备份中往返保留", () => {
  const data = initialData(), date = "2026-11-01";
  delete data.exerciseLibrary;
  data.days[date] = samplePlan(120);
  assert.ok(validateData(JSON.parse(JSON.stringify(data))));
  const exercise = data.days[date].exercises[0];
  exercise.targetWeights = [20, 22.5, 25, 27.5];
  data.exerciseLibrary = [saveExercisePreset(exercise, "胸")];
  data.templates = [{ id: "template", name: "递增组", day: clonePlan(data.days[date]) }];
  const restored = JSON.parse(JSON.stringify(data));
  assert.ok(validateData(restored));
  assert.deepEqual(restored, data);
  assert.equal(weightForSet(restored.exerciseLibrary![0].exercise, 2), 25);
});

test("导入拒绝组数不匹配和非法重量，并校验模板与动作库分类及空历史", () => {
  const data = initialData(), date = "2026-11-01";
  const plan = samplePlan(120), exercise = plan.exercises[0];
  for (const targetWeights of [null, [], [20, 30], [20, 30, 40, 50, 60], [20, -1, 30, 40], [20, 30, 40, 1001], [20, 30, NaN, 40], [20, "30", 40, 50], new Array(4)]) {
    const invalidPlan = { ...plan, exercises: [{ ...exercise, targetWeights }] };
    assert.equal(validateData({ ...data, days: { [date]: invalidPlan } }), false);
    assert.equal(validateData({ ...data, templates: [{ id: "bad", name: "坏模板", day: invalidPlan }] }), false);
    assert.equal(validateData({ ...data, exerciseLibrary: [{ id: "bad", category: "胸", exercise: invalidPlan.exercises[0] }] }), false);
  }
  const preset = saveExercisePreset(exercise, "胸");
  for (const exerciseLibrary of [null, {}, [null], [preset, preset], [{ ...preset, category: "未知" }], [{ ...preset, exercise: { ...preset.exercise, completed: true } }], [{ ...preset, exercise: { ...preset.exercise, records: [{ id: "past", reps: 12, kg: 20, duration: 30, at: 1000 }] } }]]) {
    assert.equal(validateData({ ...data, exerciseLibrary }), false);
  }
});

test("动作上下移动保留计时、历史与其他日期，模板采用新顺序", () => {
  const data = initialData(), date = "2026-10-04";
  data.days[date] = samplePlan(120);
  data.days["2026-10-03"] = samplePlan(90);
  const [first, second, third, fourth] = data.days[date].exercises;
  first.records.push({ id: "past", reps: 8, kg: 30, duration: 45, at: 1000 });
  data.timer = { phase: "work", date, exerciseId: first.id, started: 2000, deadline: 0 };
  const moved = reorderExercise(data, date, fourth.id, second.id);
  assert.deepEqual(moved.days[date].exercises, [first, fourth, second, third]);
  assert.equal(moved.timer, data.timer);
  assert.equal(moved.days[date].exercises[0], first);
  assert.equal(moved.days["2026-10-03"], data.days["2026-10-03"]);
  assert.deepEqual(data.days[date].exercises, [first, second, third, fourth]);
  const down = reorderExercise(moved, date, first.id, second.id);
  assert.deepEqual(down.days[date].exercises, [fourth, second, first, third]);
  const ended = finishSet(down, 42000);
  assert.deepEqual(ended.days[date].exercises[2].records[0], first.records[0]);
  assert.equal(ended.days[date].exercises[2].records[1].duration, 40);
  assert.equal(ended.days[date].exercises[0].records.length, 0);
  assert.deepEqual(clonePlan(down.days[date]).exercises.map((e) => e.name), [fourth, second, first, third].map((e) => e.name));
  assert.ok(validateData(JSON.parse(JSON.stringify(down))));
  assert.equal(reorderExercise(data, date, "missing", first.id), data);
  assert.equal(reorderExercise(data, "2026-01-01", first.id, second.id), data);
  assert.equal(reorderExercise(data, date, first.id, first.id), data);
});

test("完成动作按排序后的顺序切换，也不会漏掉被移到前面的未完成动作", () => {
  const data = initialData(), date = "2026-10-04";
  data.days[date] = samplePlan(120);
  const [first, second, third, fourth] = data.days[date].exercises;
  first.sets = 1;
  data.timer = { phase: "work", date, exerciseId: first.id, started: 0, deadline: 0 };
  const ended = finishSet(data, 1000);
  const reordered = reorderExercise(ended, date, fourth.id, second.id);
  assert.equal(advanceExercise(reordered, 2000).timer?.exerciseId, fourth.id);
  const toLast = reorderExercise(reordered, date, first.id, third.id);
  assert.equal(advanceExercise(toLast, 2000).timer?.exerciseId, fourth.id);
});

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
  original.note = "今天最后一组很吃力";
  original.exercises[0].targetWeights = [10, 20, 30, 40];
  original.exercises[0].records.push({
    id: "r",
    reps: 8,
    kg: 20,
    duration: 40,
    at: 123,
  });
  const cloned = clonePlan(original);
  assert.equal(cloned.note, "");
  assert.equal(original.note, "今天最后一组很吃力");
  assert.deepEqual(cloned.exercises[0].targetWeights, [10, 20, 30, 40]);
  cloned.exercises[0].targetWeights![0] = 5;
  assert.equal(original.exercises[0].targetWeights[0], 10);
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


test("逐组休息按刚完成组取值，加练沿用末组，兼容旧计划及备份", () => {
  let d = initialData();
  const date = "2026-11-03";
  d.days[date] = samplePlan(120);
  const e = d.days[date].exercises[0];
  e.sets = 3;
  e.setRests = [0, 150, 180];
  assert.ok(validateData(d));
  const cloned = clonePlan(d.days[date]);
  assert.deepEqual(cloned.exercises[0].setRests, [0, 150, 180]);
  cloned.exercises[0].setRests![0] = 60;
  assert.equal(e.setRests[0], 0);
  for (const rest of [0, 150, 180, 180]) {
    d.timer = { phase: "work", date, exerciseId: e.id, started: 1000, deadline: 1000 };
    d = finishSet(d, 41000);
    assert.equal(d.timer!.deadline, 41000 + rest * 1000);
    assert.equal(d.timer!.phase, rest ? "rest" : "ready");
    assert.ok(validateData(JSON.parse(JSON.stringify(d))));
    assert.equal(settleTimer(d, 999999).timer!.phase, "ready");
  }
  const current = d.days[date].exercises[0];
  const history = structuredClone(current.records);
  for (const invalid of [[120], [0, -1, 180], [0, 3601, 180], [0, 1.5, 180], [0, NaN, 180]]) {
    current.setRests = invalid;
    assert.equal(validateData(d), false);
  }
  delete current.setRests;
  assert.ok(validateData(d));
  d.timer = { ...d.timer!, phase: "work" };
  assert.equal(finishSet(d, 50000).timer!.deadline, 170000);
  assert.deepEqual(current.records, history);
});
