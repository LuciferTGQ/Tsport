export type SetRecord = {
  id: string;
  reps: number;
  kg: number;
  duration: number | null;
  at: number;
};
export type Exercise = {
  id: string;
  name: string;
  sets: number;
  reps: number;
  kg: number;
  seconds: number;
  rest: number;
  records: SetRecord[];
  completed?: boolean;
};
export type Day = { tags: string[]; exercises: Exercise[]; note: string };
export type Timer = {
  phase: "work" | "rest" | "ready";
  date: string;
  exerciseId: string;
  started: number;
  deadline: number;
  kind?: "set" | "exercise";
} | null;
export type Data = {
  version: 1;
  days: Record<string, Day>;
  weights: Record<string, number>;
  tags: { id: string; name: string; color: string }[];
  templates: { id: string; name: string; day: Day }[];
  settings: {
    rest: number;
    exerciseRest?: number;
    sound: boolean;
    notifications?: boolean;
    vibration?: boolean;
  };
  timer: Timer;
};
export const uid = () => crypto.randomUUID();
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const parseDate = (key: string) => new Date(`${key}T12:00:00`);
export const emptyDay = (): Day => ({ tags: [], exercises: [], note: "" });
export const newExercise = (name = "新动作", rest = 120): Exercise => ({
  id: uid(),
  name,
  sets: 4,
  reps: 12,
  kg: 0,
  seconds: 45,
  rest,
  records: [],
});
export const initialData = (): Data => ({
  version: 1,
  days: {},
  weights: {},
  tags: [
    { id: "chest", name: "胸", color: "#deede7" },
    { id: "shoulder", name: "肩", color: "#f5eacb" },
    { id: "back", name: "背", color: "#e0e8f7" },
    { id: "leg", name: "腿", color: "#eee0f3" },
    { id: "rest", name: "休息", color: "#e8e9ed" },
  ],
  templates: [],
  settings: { rest: 120, exerciseRest: 120, sound: true, notifications: false, vibration: true },
  timer: null,
});
/** Add the built-in rest label to older installations without altering their days. */
export function migrateData(data: Data): Data {
  if (data.tags.some((tag) => tag.name === "休息")) return data;
  return {
    ...data,
    tags: [...data.tags, {
      id: data.tags.some((tag) => tag.id === "rest") ? uid() : "rest",
      name: "休息",
      color: "#e8e9ed",
    }],
  };
}
export function completeExercise(data: Data, date: string, id: string): Data {
  const day = data.days[date];
  const exercise = day?.exercises.find((e) => e.id === id);
  if (!exercise || exercise.records.length < exercise.sets || data.timer?.phase === "work")
    return data;
  return {
    ...data,
    days: {
      ...data.days,
      [date]: {
        ...day,
        exercises: day.exercises.map((e) =>
          e.id === id ? { ...e, completed: true } : e),
      },
    },
    timer: data.timer?.date === date && data.timer.exerciseId === id ? null : data.timer,
  };
}
export function advanceExercise(data: Data, now: number): Data {
  const timer = data.timer;
  if (!timer || timer.phase === "work") return data;
  const completed = completeExercise(data, timer.date, timer.exerciseId);
  if (completed === data) return data;
  const exercises = completed.days[timer.date].exercises;
  const index = exercises.findIndex((e) => e.id === timer.exerciseId);
  const next = exercises.slice(index + 1).find((e) => !e.completed && e.records.length < e.sets);
  if (!next) return completed;
  const rest = data.settings.exerciseRest ?? 120;
  return { ...completed, timer: {
    phase: rest > 0 ? "rest" : "ready", kind: "exercise",
    date: timer.date, exerciseId: next.id, started: now, deadline: now + rest * 1000,
  } };
}
export function samplePlan(rest: number): Day {
  return {
    tags: ["chest"],
    note: "",
    exercises: ["杠铃卧推", "上斜哑铃卧推", "绳索夹胸", "俯卧撑"].map((name) =>
      newExercise(name, rest),
    ),
  };
}
export const completedSets = (day?: Day) =>
  day?.exercises.reduce((n, e) => n + e.records.length, 0) ?? 0;
export function clonePlan(day: Day): Day {
  return {
    tags: [...day.tags],
    note: day.note,
    exercises: day.exercises.map((e) => ({
      ...e, id: uid(), records: [], completed: false,
    })),
  };
}
export function finishSet(data: Data, now: number): Data {
  const t = data.timer;
  if (!t || t.phase !== "work") return data;
  const day = data.days[t.date],
    exercise = day?.exercises.find((e) => e.id === t.exerciseId);
  if (!exercise) return { ...data, timer: null };
  const record: SetRecord = {
    id: uid(),
    reps: exercise.reps,
    kg: exercise.kg,
    duration: Math.max(0, Math.floor((now - t.started) / 1000)),
    at: now,
  };
  return {
    ...data,
    days: {
      ...data.days,
      [t.date]: {
        ...day,
        exercises: day.exercises.map((e) =>
          e.id === exercise.id ? { ...e, records: [...e.records, record] } : e,
        ),
      },
    },
    timer: {
      ...t,
      kind: "set",
      phase: exercise.rest > 0 ? "rest" : "ready",
      started: now,
      deadline: now + exercise.rest * 1000,
    },
  };
}
export function settleTimer(data: Data, now: number): Data {
  return data.timer?.phase === "rest" && now >= data.timer.deadline
    ? { ...data, timer: { ...data.timer, phase: "ready" } }
    : data;
}
export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
export function validateData(value: unknown): value is Data {
  if (!value || typeof value !== "object") return false;
  const d = value as Data;
  const num = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const date = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !isNaN(parseDate(s).getTime()) &&
    dateKey(parseDate(s)) === s;
  const str = (s: unknown) => typeof s === "string" && s.length <= 5000;
  const day = (v: Day) =>
    v &&
    Array.isArray(v.tags) &&
    v.tags.every(str) &&
    str(v.note) &&
    Array.isArray(v.exercises) &&
    new Set(v.exercises.map((e) => e.id)).size === v.exercises.length &&
    v.exercises.every(
      (e) =>
        str(e.id) &&
        str(e.name) &&
        num(e.sets, 1, 100) &&
        Number.isInteger(e.sets) &&
        num(e.reps, 1, 999) &&
        Number.isInteger(e.reps) &&
        num(e.kg, 0, 1000) &&
        num(e.seconds, 1, 3600) &&
        num(e.rest, 0, 3600) &&
        (e.completed === undefined || typeof e.completed === "boolean") &&
        Array.isArray(e.records) &&
        e.records.every(
          (r) =>
            str(r.id) &&
            num(r.reps, 0, 999) &&
            Number.isInteger(r.reps) &&
            num(r.kg, 0, 1000) &&
            (r.duration === null || num(r.duration, 0, 31536000)) &&
            num(r.at, 0, 8640000000000000),
        ),
    );
  try {
    return (
      d.version === 1 &&
      !!d.days &&
      typeof d.days === "object" &&
      !Array.isArray(d.days) &&
      Object.entries(d.days).every(([k, v]) => date(k) && day(v)) &&
      !!d.weights &&
      typeof d.weights === "object" &&
      !Array.isArray(d.weights) &&
      Object.entries(d.weights).every(([k, v]) => date(k) && num(v, 1, 500)) &&
      Array.isArray(d.tags) &&
      d.tags.every(
        (t) => str(t.id) && str(t.name) && /^#[0-9a-f]{6}$/i.test(t.color),
      ) &&
      Array.isArray(d.templates) &&
      d.templates.every((t) => str(t.id) && str(t.name) && day(t.day)) &&
      num(d.settings.rest, 0, 3600) &&
      (d.settings.exerciseRest === undefined || num(d.settings.exerciseRest, 0, 3600)) &&
      typeof d.settings.sound === "boolean" &&
      (d.settings.notifications === undefined ||
        typeof d.settings.notifications === "boolean") &&
      (d.settings.vibration === undefined ||
        typeof d.settings.vibration === "boolean") &&
      (d.timer === null ||
        (!!d.timer &&
          ["work", "rest", "ready"].includes(d.timer.phase) &&
          (d.timer.kind === undefined || ["set", "exercise"].includes(d.timer.kind)) &&
          date(d.timer.date) &&
          str(d.timer.exerciseId) &&
          num(d.timer.started, 0, 8640000000000000) &&
          num(d.timer.deadline, 0, 8640000000000000) &&
          !!d.days[d.timer.date]?.exercises.some(
            (e) => e.id === d.timer!.exerciseId,
          )))
    );
  } catch {
    return false;
  }
}
