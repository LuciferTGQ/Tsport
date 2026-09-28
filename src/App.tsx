import { useEffect, useRef, useState, type ReactNode } from "react";
import ReminderSettings from "./ReminderSettings";
import AndroidReminderSettings from "./AndroidReminderSettings";
import {
  isAndroid,
  syncNativeReminder,
  listenNativeReminders,
} from "./nativeReminders";
import {
  closeRestNotifications,
  showRestNotification,
  validReminderTarget,
  type ReminderTarget,
} from "./reminders";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Dumbbell,
  Edit3,
  Flag,
  LayoutTemplate,
  Play,
  Plus,
  Scale,
  Settings,
  SkipForward,
  Timer as TimerIcon,
  Trash2,
  TrendingUp,
  Volume2,
  X,
} from "lucide-react";
import {
  clonePlan,
  completedSets,
  advanceExercise,
  dateKey,
  emptyDay,
  finishSet,
  formatTime,
  initialData,
  migrateData,
  newExercise,
  parseDate,
  samplePlan,
  settleTimer,
  uid,
  validateData,
  type Data,
  type Day,
  type Exercise,
  type SetRecord,
} from "./model";

const KEY = "tsport-v1";
let bootError = "";
function readData() {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return initialData();
    const d: unknown = JSON.parse(s);
    if (validateData(d)) return migrateData(d);
    bootError = "已有数据无法读取。原始数据已保留，请先导出原始备份再恢复。";
  } catch {
    bootError = "无法读取本地记录，请检查浏览器存储权限。";
  }
  return initialData();
}
type ModalState =
  | { kind: "exercise"; exercise: Exercise }
  | { kind: "weight" }
  | { kind: "tags" }
  | { kind: "templates" }
  | { kind: "saveTemplate" }
  | { kind: "record"; exerciseId: string; record: SetRecord }
  | { kind: "confirm"; title: string; text: string; action: () => void };
let audioContext: AudioContext | undefined;
function unlockAudio() {
  try {
    audioContext ??= new AudioContext();
    void audioContext.resume();
  } catch {}
}
function ring() {
  try {
    if (!audioContext) return;
    for (let i = 0; i < 3; i++) {
      const o = audioContext.createOscillator(),
        g = audioContext.createGain();
      o.connect(g);
      g.connect(audioContext.destination);
      o.frequency.value = 740;
      g.gain.value = 0.12;
      const t = audioContext.currentTime + i * 0.4;
      o.start(t);
      o.stop(t + 0.2);
    }
  } catch {}
}

export default function App() {
  const [data, setData] = useState<Data>(readData),
    [selected, setSelected] = useState(dateKey()),
    [month, setMonth] = useState(dateKey().slice(0, 7)),
    [tab, setTab] = useState("calendar"),
    [modal, setModal] = useState<ModalState | null>(null),
    [now, setNow] = useState(Date.now()),
    [toast, setToast] = useState(""),
    [storageError, setStorageError] = useState(bootError),
    [range, setRange] = useState("30");
  const [restAlert, setRestAlert] = useState<ReminderTarget | null>(null);
  const [nativeAlarmStatus, setNativeAlarmStatus] = useState("");
  const [nativeResume, setNativeResume] = useState(0);
  const lastReminder = useRef("");
  const nativeSent = useRef<Data | null>(null);
  const nativeRevision = useRef(0);
  const latestData = useRef(data);
  latestData.current = data;
  const fileRef = useRef<HTMLInputElement>(null),
    saveBlocked = useRef(!!bootError);
  const today = dateKey(),
    day = data.days[selected] ?? emptyDay(),
    timer = data.timer;
  const notify = (message: string) => setToast(message);
  useEffect(() => {
    if (saveBlocked.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      setStorageError("");
    } catch {
      setStorageError("保存失败：本地空间不足或存储不可用，请立即导出备份。");
    }
  }, [data]);
  useEffect(() => {
    setNow(Date.now());
    if (!timer || timer.phase === "ready") return;
    const update = () => setNow(Date.now());
    const id = setInterval(update, 250);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [timer?.phase, timer?.started]);
  useEffect(() => {
    if (timer?.phase === "rest" && now >= timer.deadline) {
      const key = `${timer.date}/${timer.exerciseId}/${timer.started}/${timer.deadline}`;
      setData((d) => settleTimer(d, Date.now()));
      if (lastReminder.current === key) return;
      lastReminder.current = key;
      const target = { date: timer.date, exerciseId: timer.exerciseId };
      setRestAlert(target);
      const hidden = document.visibilityState === "hidden";
      if (
        (!isAndroid && (!hidden || !data.settings.notifications)) ||
        (isAndroid && !data.settings.notifications)
      ) {
        if (data.settings.sound) ring();
        if (data.settings.vibration !== false && "vibrate" in navigator)
          navigator.vibrate([250, 120, 250]);
      }
      if (data.settings.notifications && !isAndroid) {
        const name =
          data.days[timer.date]?.exercises.find(
            (e) => e.id === timer.exerciseId,
          )?.name ?? "本组训练";
        void showRestNotification(
          target,
          name,
          data.settings.vibration !== false,
          () => {
            const current = latestData.current;
            return (
              !!current.settings.notifications &&
              (current.timer?.phase === "ready" ||
                current.timer?.phase === "rest") &&
              current.timer.started === timer.started &&
              current.timer.deadline === timer.deadline
            );
          },
        ).catch(() => notify("系统通知未能发送，休息已结束。请检查通知设置。"));
      }
      notify("休息结束，准备好后再开始下一组。");
    }
  }, [
    now,
    timer,
    data.settings.sound,
    data.settings.notifications,
    data.settings.vibration,
  ]);
  useEffect(() => {
    if (!timer || timer.phase !== "ready") setRestAlert(null);
    if (
      !isAndroid &&
      (!timer || timer.phase === "work" || !data.settings.notifications)
    )
      void closeRestNotifications();
  }, [timer?.phase, data.settings.notifications]);
  function arrangeNative(next: Data) {
    const revision = ++nativeRevision.current;
    void syncNativeReminder(next).then((result) => {
      if (revision !== nativeRevision.current) return;
      setNativeAlarmStatus({
        scheduled: "通知栏倒计时已启动 · 系统闹钟已安排",
        foreground: "通知栏倒计时已启动 · 建议允许准时闹钟",
        off: "", ready: "",
      }[result]);
    }).catch((error: unknown) => {
      if (revision !== nativeRevision.current) return;
      const message = error instanceof Error ? error.message : "原生计时启动失败";
      setNativeAlarmStatus(message);
      notify(`后台提醒未启动：${message}`);
    });
  }
  // User actions dispatch to native immediately, before React's later effect or background pause.
  function commitTraining(next: Data) {
    latestData.current = next;
    setData(next);
    if (isAndroid) {
      nativeSent.current = next;
      arrangeNative(next);
    }
  }
  useEffect(() => {
    if (!isAndroid) return;
    if (nativeSent.current === data) { nativeSent.current = null; return; }
    arrangeNative(data);
  }, [timer?.phase, timer?.started, timer?.deadline, timer?.exerciseId,
    data.settings.notifications, data.settings.vibration, data.settings.sound, nativeResume]);
  function openTraining(target: ReminderTarget | null) {
    setTab("calendar");
    setModal(null);
    setRestAlert(null);
    if (target && latestData.current.days[target.date]) {
      setSelected(target.date);
      setMonth(target.date.slice(0, 7));
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        (
          (target &&
            document.getElementById(`exercise-${target.exerciseId}`)) ||
          document.getElementById("day-detail")
        )?.scrollIntoView({ behavior: "smooth", block: "start" });
      }),
    );
  }
  useEffect(() => {
    if (isAndroid)
      return listenNativeReminders(openTraining, () => {
        setNow(Date.now());
        setNativeResume((n) => n + 1);
      });
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "TSPORT_OPEN_TRAINING") return;
      openTraining(
        validReminderTarget(event.data.target) ? event.data.target : null,
      );
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    const url = new URL(location.href);
    if (url.searchParams.has("training")) {
      const target = {
        date: url.searchParams.get("training"),
        exerciseId: url.searchParams.get("exercise"),
      };
      openTraining(validReminderTarget(target) ? target : null);
      url.searchParams.delete("training");
      url.searchParams.delete("exercise");
      history.replaceState(null, "", url);
    }
    return () =>
      navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!timer) return;
    let lock: WakeLockSentinel | undefined;
    const acquire = () => {
      if (document.visibilityState === "visible")
        navigator.wakeLock
          ?.request("screen")
          .then((l) => {
            lock = l;
          })
          .catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      void lock?.release();
      document.removeEventListener("visibilitychange", acquire);
    };
  }, [!!timer]);
  const patchDay = (fn: (d: Day) => Day, date = selected) =>
    setData((d) => ({
      ...d,
      days: { ...d.days, [date]: fn(d.days[date] ?? emptyDay()) },
    }));
  const chooseDate = (date: string) => {
    setSelected(date);
    setMonth(date.slice(0, 7));
  };
  const editExercise = (e: Exercise) => {
    if (timer?.phase === "work" && timer.exerciseId === e.id) {
      notify("请先结束本组，再修改目标。");
      return;
    }
    setModal({ kind: "exercise", exercise: e });
  };
  const start = (id: string, date = selected) => {
    unlockAudio();
    const d = latestData.current;
    if (d.timer?.phase === "work") return;
    commitTraining({
      ...d,
      days: { ...d.days, [date]: { ...d.days[date], exercises: d.days[date].exercises.map((e) =>
        e.id === id ? { ...e, completed: false } : e) } },
      timer: { phase: "work", date, exerciseId: id, started: Date.now(), deadline: 0 },
    });
  };
  const complete = () => {
    const next = advanceExercise(latestData.current, Date.now());
    commitTraining(next);
    setRestAlert(null);
    notify(next.timer ? "已完成，休息后开始下一个动作" : "该动作已完成，计时已结束");
  };
  const showCompletion = (id: string) => {
    const d = latestData.current;
    if (d.timer?.phase === "work") return;
    const now = Date.now();
    commitTraining({ ...d, timer: { phase: "ready", date: selected, exerciseId: id, started: now, deadline: now } });
  };
  const quick = (e: Exercise) => {
    if (timer?.phase === "work") {
      notify("请先结束正在计时的一组。");
      return;
    }
    patchDay((d) => ({
      ...d,
      exercises: d.exercises.map((x) =>
        x.id === e.id
          ? {
              ...x,
              completed: false,
              records: [
                ...x.records,
                {
                  id: uid(),
                  reps: x.reps,
                  kg: x.kg,
                  duration: null,
                  at: Date.now(),
                },
              ],
            }
          : x,
      ),
    }));
    notify("已补记一组 · 未计时");
  };
  const monthDate = parseDate(`${month}-01`),
    offset = (monthDate.getDay() + 6) % 7;
  const daysInMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0,
  ).getDate();
  const monthDays = Object.entries(data.days).filter(([k]) =>
    k.startsWith(month),
  );
  const activeDays = monthDays.filter(([, d]) => completedSets(d) > 0).length;
  const monthSets = monthDays.reduce((n, [, d]) => n + completedSets(d), 0);
  const target = day.exercises.reduce((n, e) => n + e.sets, 0),
    done = completedSets(day);
  const activeExercise = timer
    ? data.days[timer.date]?.exercises.find((e) => e.id === timer.exerciseId)
    : undefined;
  const activeSeconds =
    timer?.phase === "work"
      ? (now - timer.started) / 1000
      : timer?.phase === "rest"
        ? Math.ceil((timer.deadline - now) / 1000)
        : 0;
  const weights = Object.entries(data.weights).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(range) + 1);
  const visibleWeights = weights.filter(
    ([date]) => date <= today && (range === "all" || date >= dateKey(cutoff)),
  );
  const latest = weights.filter(([d]) => d <= today).at(-1);
  async function exportData(raw = false) {
    if (isAndroid) {
      try {
        const [{ Filesystem, Directory, Encoding }, { Share }] =
          await Promise.all([
            import("@capacitor/filesystem"),
            import("@capacitor/share"),
          ]);
        const result = await Filesystem.writeFile({
          path: `tsport-${today}${raw ? "-raw" : ""}.json`,
          data: raw
            ? (localStorage.getItem(KEY) ?? "{}")
            : JSON.stringify(data, null, 2),
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        await Share.share({
          title: "Tsport 训练备份",
          url: result.uri,
          dialogTitle: "保存或分享训练备份",
        });
      } catch {
        notify("备份导出未完成，请重试。");
      }
      return;
    }
    const blob = new Blob(
      [
        raw
          ? (localStorage.getItem(KEY) ?? "{}")
          : JSON.stringify(data, null, 2),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tsport-${today}${raw ? "-raw" : ""}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw Error();
      const d: unknown = JSON.parse(await file.text());
      if (!validateData(d)) throw Error();
      setModal({
        kind: "confirm",
        title: "恢复备份",
        text: "此备份将替换当前全部记录。建议先导出当前数据。恢复后未完成的计时将停止，完成记录会保留。",
        action: () => {
          saveBlocked.current = false;
          setData({ ...migrateData(d), timer: null });
          setStorageError("");
          notify("备份已恢复");
        },
      });
    } catch {
      notify("备份格式无效或文件过大，当前记录未修改。");
    }
    if (fileRef.current) fileRef.current.value = "";
  }
  function removeExercise(e: Exercise) {
    if (timer?.exerciseId === e.id) {
      notify("请先关闭当前训练计时。");
      return;
    }
    setModal({
      kind: "confirm",
      title: "删除动作？",
      text: `「${e.name}」及其 ${e.records.length} 组记录会一并删除。`,
      action: () =>
        patchDay((d) => ({
          ...d,
          exercises: d.exercises.filter((x) => x.id !== e.id),
        })),
    });
  }
  function usePlan(plan: Day) {
    if (timer?.date === selected) {
      notify("请先关闭这一天的计时再载入计划。");
      return;
    }
    const action = () => {
      patchDay(() => clonePlan(plan));
      setModal(null);
      notify("计划已载入");
    };
    if (day.exercises.length)
      setModal({
        kind: "confirm",
        title: "替换当天计划？",
        text: "当前动作及完成记录会被替换，体重记录不受影响。",
        action,
      });
    else action();
  }
  const monthMove = (delta: number) => {
    const d = parseDate(`${month}-01`);
    d.setMonth(d.getMonth() + delta);
    setMonth(dateKey(d).slice(0, 7));
  };
  const nav = [
    { id: "calendar", name: "训练日历", icon: CalendarDays },
    { id: "weight", name: "体重趋势", icon: TrendingUp },
    { id: "settings", name: "偏好设置", icon: Settings },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("calendar");
          }}
        >
          <span className="brand-icon">T</span>
          <span>
            Tsport<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="sidebar-caption">你的私人训练空间</div>
        <nav>
          {nav.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "nav-item active" : "nav-item"}
              onClick={() => setTab(id)}
            >
              <Icon size={20} />
              <span>{name}</span>
              {tab === id && <span className="nav-mark" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-bar">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <strong>每一组，都算数。</strong>
          <p>
            按照自己的节奏，
            <br />
            记录每一次进步。
          </p>
          <div className="local-label">
            <span /> 本机保存 · 私人记录
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            个人训练日志 <span className="slash">/</span>{" "}
            {nav.find((n) => n.id === tab)?.name}
          </span>
          <span className="top-date">
            {new Intl.DateTimeFormat("zh-CN", {
              month: "long",
              day: "numeric",
              weekday: "long",
            }).format(new Date())}
            <span className="avatar">我</span>
          </span>
        </header>
        {storageError && (
          <div className="error-banner">
            {storageError}
            <button onClick={() => exportData(true)}>导出原始备份</button>
          </div>
        )}
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {tab === "calendar"
                  ? "TRAINING JOURNAL"
                  : tab === "weight"
                    ? "BODY PROGRESS"
                    : "MAKE IT YOURS"}
              </div>
              <h1>
                {tab === "calendar"
                  ? "把进步，记下来。"
                  : tab === "weight"
                    ? "看见身体的变化。"
                    : "按你的节奏训练。"}
              </h1>
              <p>
                {tab === "calendar"
                  ? "安排训练，专注当下。每一个绿色的日子，都是积累。"
                  : tab === "weight"
                    ? "记录真实变化，给长期坚持一点时间。"
                    : "调整休息时间，管理你的个人记录。"}
              </p>
            </div>
            {tab === "calendar" ? (
              <button
                className="primary"
                onClick={() => {
                  chooseDate(today);
                  document
                    .getElementById("day-detail")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <Plus size={18} /> 今天的训练
              </button>
            ) : tab === "weight" ? (
              <button
                className="primary"
                onClick={() => setModal({ kind: "weight" })}
              >
                <Plus size={18} /> 记录体重
              </button>
            ) : null}
          </div>
          {tab === "calendar" && (
            <>
              <div className="stat-grid">
                <Stat
                  icon={<CalendarDays />}
                  title="本月训练"
                  value={activeDays}
                  unit="天"
                  detail={`${month.replace("-", " 年 ")} 月`}
                />
                <Stat
                  icon={<Dumbbell />}
                  title="本月完成"
                  value={monthSets}
                  unit="组"
                  detail="每一次认真完成的练习"
                />
                <Stat
                  icon={<Scale />}
                  title="最新体重"
                  value={latest ? latest[1] : "—"}
                  unit="kg"
                  detail={latest ? `${latest[0]} 记录` : "从第一次记录开始"}
                  onClick={() => setModal({ kind: "weight" })}
                />
              </div>
              <div className="workspace">
                <section className="calendar-panel panel">
                  <div className="panel-top">
                    <div>
                      <h2>训练日历</h2>
                      <span className="subtle">让坚持留下痕迹</span>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => chooseDate(today)}
                    >
                      回到今天
                    </button>
                  </div>
                  <div className="month-toolbar">
                    <label className="month-label">
                      <input
                        aria-label="选择年月"
                        type="month"
                        value={month}
                        onChange={(e) => {
                          if (e.target.value) setMonth(e.target.value);
                        }}
                      />
                    </label>
                    <div>
                      <button
                        className="icon-button"
                        aria-label="上个月"
                        onClick={() => monthMove(-1)}
                      >
                        <ChevronLeft size={19} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="下个月"
                        onClick={() => monthMove(1)}
                      >
                        <ChevronRight size={19} />
                      </button>
                    </div>
                  </div>
                  <div className="calendar-grid">
                    {"一二三四五六日".split("").map((w) => (
                      <div className="weekday" key={w}>
                        {w}
                      </div>
                    ))}
                    {Array.from({ length: offset }, (_, i) => (
                      <div className="calendar-spacer" key={`s${i}`} />
                    ))}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const key = `${month}-${String(i + 1).padStart(2, "0")}`,
                        d = data.days[key],
                        worked = completedSets(d) > 0;
                      return (
                        <button
                          aria-label={`${key}${worked ? " 已训练" : ""}`}
                          aria-pressed={selected === key}
                          key={key}
                          onClick={() => {
                            setSelected(key);
                            if (innerWidth <= 700)
                              document
                                .getElementById("day-detail")
                                ?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                });
                          }}
                          className={`calendar-day ${worked ? "worked" : ""} ${selected === key ? "selected" : ""} ${today === key ? "today" : ""}`}
                        >
                          <span className="day-number">
                            {i + 1}
                            {today === key && <i />}
                          </span>
                          <span className="day-tags">
                            {d?.tags.slice(0, 2).map((id) => {
                              const tag = data.tags.find((t) => t.id === id);
                              return (
                                tag && (
                                  <span
                                    key={id}
                                    style={{ background: tag.color }}
                                  >
                                    {tag.name}
                                  </span>
                                )
                              );
                            })}
                            {(d?.tags.length ?? 0) > 2 && (
                              <small>+{d!.tags.length - 2}</small>
                            )}
                          </span>
                          {!!data.weights[key] && (
                            <span className="weight-dot" title="已记录体重" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="calendar-legend">
                    <span>
                      <i className="legend-worked" /> 已训练
                    </span>
                    <span>
                      <i className="legend-plan" /> 已安排标签
                    </span>
                    <span>
                      <i className="legend-weight" /> 已记体重
                    </span>
                  </div>
                  <div className="calendar-footer">
                    <Flag size={17} />
                    <span>有完成组记录，当天就会亮起绿色。</span>
                  </div>
                </section>
                <section id="day-detail" className="day-panel panel">
                  <div className="panel-top">
                    <div className="day-title">
                      <span className="date-square">
                        {parseDate(selected).getDate()}
                      </span>
                      <div>
                        <h2>
                          {selected === today
                            ? "今天"
                            : `${parseDate(selected).getMonth() + 1} 月 ${parseDate(selected).getDate()} 日`}
                          的训练
                        </h2>
                        <span className="subtle">
                          {selected} · 周
                          {"日一二三四五六"[parseDate(selected).getDay()]}
                        </span>
                      </div>
                    </div>
                    <button
                      className="icon-button"
                      title="训练模板"
                      aria-label="训练模板"
                      onClick={() => setModal({ kind: "templates" })}
                    >
                      <LayoutTemplate size={19} />
                    </button>
                  </div>
                  <div className="tags-row">
                    {day.tags.map((id) => {
                      const t = data.tags.find((x) => x.id === id);
                      return (
                        t && (
                          <span
                            className="tag"
                            style={{ background: t.color }}
                            key={id}
                          >
                            {t.name}
                          </span>
                        )
                      );
                    })}
                    <button
                      className="tag-add"
                      onClick={() => setModal({ kind: "tags" })}
                    >
                      <Plus size={14} /> 标签
                    </button>
                    <button
                      className="weight-chip"
                      onClick={() => setModal({ kind: "weight" })}
                    >
                      <Scale size={14} />
                      {data.weights[selected]
                        ? `${data.weights[selected]} kg`
                        : "记体重"}
                    </button>
                  </div>
                  {day.exercises.length > 0 ? (
                    <>
                      <div className="progress-label">
                        <span>
                          今日进度{" "}
                          <strong>
                            {done} / {target} 组
                          </strong>
                        </span>
                        <span>{Math.round((done / target) * 100)}%</span>
                      </div>
                      <div className="progress-track">
                        <i
                          style={{
                            width: `${Math.min((done / target) * 100, 100)}%`,
                          }}
                        />
                      </div>
                      <div className="exercise-list">
                        {day.exercises.map((e, index) => (
                          <article
                            id={`exercise-${e.id}`}
                            className={`exercise-card ${timer?.exerciseId === e.id ? "focused" : ""}`}
                            key={e.id}
                          >
                            <div className="exercise-head">
                              <span className="exercise-index">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <button
                                className="exercise-name"
                                onClick={() => editExercise(e)}
                              >
                                {e.name}
                                <Edit3 size={13} />
                              </button>
                              <button
                                className="icon-button remove"
                                aria-label={`删除${e.name}`}
                                onClick={() => removeExercise(e)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                            <div className="exercise-info">
                              <span>
                                目标{" "}
                                <b>
                                  {e.sets} × {e.reps}
                                </b>
                                {e.kg > 0 && ` · ${e.kg} kg`}
                              </span>
                              <span>预计 {formatTime(e.seconds)} / 组</span>
                            </div>
                            <div className="exercise-actions">
                              <div className="set-dots">
                                {Array.from(
                                  {
                                    length: Math.min(
                                      Math.max(e.sets, e.records.length),
                                      8,
                                    ),
                                  },
                                  (_, i) => (
                                    <button
                                      key={i}
                                      aria-label={`${e.name}第${i + 1}组${e.records[i] ? "记录" : "未完成"}`}
                                      disabled={!e.records[i]}
                                      className={
                                        e.records[i]
                                          ? "set-dot complete"
                                          : "set-dot"
                                      }
                                      onClick={() =>
                                        setModal({
                                          kind: "record",
                                          exerciseId: e.id,
                                          record: e.records[i],
                                        })
                                      }
                                    >
                                      {e.records[i] ? (
                                        <Check size={15} />
                                      ) : (
                                        i + 1
                                      )}
                                    </button>
                                  ),
                                )}
                                {Math.max(e.sets, e.records.length) > 8 && (
                                  <span>…</span>
                                )}
                              </div>
                              <button
                                className="quick-add"
                                aria-label={`为${e.name}加一组`}
                                disabled={timer?.phase === "work"}
                                onClick={() => quick(e)}
                              >
                                <Plus size={19} />
                              </button>
                            </div>
                            <div className="exercise-bottom">
                              <span>
                                {e.completed ? "动作已完成 · " : ""}
                                {e.records.length} 组完成 · 休息{" "}
                                {formatTime(e.rest)}
                              </span>
                              <button
                                disabled={timer?.phase === "work"}
                                onClick={() => !e.completed && e.records.length >= e.sets ? showCompletion(e.id) : start(e.id)}
                              >
                                <Play size={13} />
                                {e.completed ? "再加练一组" :
                                  e.records.length >= e.sets ? "查看完成选项" : e.records.length ? "开始下一组" : "开始本组"}
                              </button>
                            </div>
                            {e.records.length > 0 && (
                              <details>
                                <summary>
                                  查看记录 · 实练{" "}
                                  {formatTime(
                                    e.records.reduce(
                                      (n, r) => n + (r.duration ?? 0),
                                      0,
                                    ),
                                  )}
                                </summary>
                                {e.records.map((r, i) => (
                                  <button
                                    className="record-line"
                                    key={r.id}
                                    onClick={() =>
                                      setModal({
                                        kind: "record",
                                        exerciseId: e.id,
                                        record: r,
                                      })
                                    }
                                  >
                                    <span>第 {i + 1} 组</span>
                                    <span>
                                      {r.reps} 次 · {r.kg} kg
                                    </span>
                                    <span>
                                      {r.duration === null
                                        ? "未计时"
                                        : formatTime(r.duration)}{" "}
                                      <Edit3 size={12} />
                                    </span>
                                  </button>
                                ))}
                              </details>
                            )}
                          </article>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="empty-plan">
                      <div className="empty-icon">
                        <Dumbbell size={29} />
                      </div>
                      <h3>为这一天安排训练</h3>
                      <p>从四个动作开始，或建立自己的计划。</p>
                      <button
                        className="primary"
                        onClick={() => usePlan(samplePlan(data.settings.rest))}
                      >
                        <Plus size={17} /> 载入四动作示例
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setModal({ kind: "templates" })}
                      >
                        从我的模板选择
                      </button>
                    </div>
                  )}
                  <button
                    className="add-exercise"
                    onClick={() =>
                      editExercise(newExercise("新动作", data.settings.rest))
                    }
                  >
                    <Plus size={17} /> 添加训练动作
                  </button>
                  {day.exercises.length > 0 && (
                    <button
                      className="save-template text-button"
                      onClick={() => setModal({ kind: "saveTemplate" })}
                    >
                      <LayoutTemplate size={15} /> 保存为训练模板
                    </button>
                  )}
                  <label className="notes-label">
                    训练随记
                    <textarea
                      placeholder="今天的状态、动作感受……"
                      value={day.note}
                      onChange={(e) =>
                        patchDay((d) => ({ ...d, note: e.target.value }))
                      }
                    />
                  </label>
                </section>
              </div>
            </>
          )}
          {tab === "weight" && (
            <>
              <div className="stat-grid">
                <Stat
                  icon={<Scale />}
                  title="最新体重"
                  value={latest ? latest[1] : "—"}
                  unit="kg"
                  detail={latest?.[0] ?? "尚未记录"}
                />
                <Stat
                  icon={<Activity />}
                  title="区间变化"
                  value={
                    visibleWeights.length > 1
                      ? `${visibleWeights.at(-1)![1] - visibleWeights[0][1] > 0 ? "+" : ""}${(visibleWeights.at(-1)![1] - visibleWeights[0][1]).toFixed(1)}`
                      : "—"
                  }
                  unit="kg"
                  detail="区间最后一次 − 第一次"
                />
                <Stat
                  icon={<CalendarDays />}
                  title="累计记录"
                  value={weights.length}
                  unit="天"
                  detail="每天一点，慢慢看见变化"
                />
              </div>
              <section className="panel weight-panel">
                <div className="panel-top">
                  <div>
                    <h2>体重变化</h2>
                    <span className="subtle">单位 kg · 按实际记录日期展示</span>
                  </div>
                  <div className="segmented">
                    {[
                      ["30", "30 天"],
                      ["90", "90 天"],
                      ["all", "全部"],
                    ].map(([v, l]) => (
                      <button
                        key={v}
                        className={range === v ? "active" : ""}
                        onClick={() => setRange(v)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <WeightChart points={visibleWeights} />
              </section>
              <section className="panel weight-history">
                <div className="panel-top">
                  <h2>记录明细</h2>
                  <button
                    className="text-button"
                    onClick={() => setModal({ kind: "weight" })}
                  >
                    <Plus size={16} /> 添加记录
                  </button>
                </div>
                {weights.length ? (
                  [...weights].reverse().map(([date, kg]) => (
                    <div className="weight-row" key={date}>
                      <span>{date}</span>
                      <strong>
                        {kg} <small>kg</small>
                      </strong>
                      <button
                        className="icon-button"
                        aria-label={`编辑${date}体重`}
                        onClick={() => {
                          setSelected(date);
                          setModal({ kind: "weight" });
                        }}
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`删除${date}体重`}
                        onClick={() =>
                          setModal({
                            kind: "confirm",
                            title: "删除体重记录？",
                            text: `删除 ${date} 的 ${kg} kg 记录。`,
                            action: () =>
                              setData((d) => {
                                const w = { ...d.weights };
                                delete w[date];
                                return { ...d, weights: w };
                              }),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="empty-text">
                    还没有体重记录，先记下今天的体重吧。
                  </p>
                )}
              </section>
            </>
          )}
          {tab === "settings" && (
            <div className="settings-grid">
              <section className="panel settings-panel">
                <h2>
                  <TimerIcon size={20} /> 训练偏好
                </h2>
                <label>
                  默认组间休息{" "}
                  <span className="subtle">
                    新建动作使用此设置；已有动作可单独调整。
                  </span>
                  <div className="input-unit">
                    <input
                      aria-label="默认休息秒数"
                      type="number"
                      min="0"
                      max="3600"
                      value={data.settings.rest}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 0 && n <= 3600)
                          setData((d) => ({
                            ...d,
                            settings: { ...d.settings, rest: n },
                          }));
                      }}
                    />
                    <span>秒</span>
                  </div>
                </label>
                <label>
                  <span>动作间休息</span>
                  <div className="input-unit">
                    <input aria-label="动作间休息秒数" type="number" min="0" max="3600"
                      value={data.settings.exerciseRest ?? 120}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 0 && n <= 3600)
                          setData((d) => ({ ...d, settings: { ...d.settings, exerciseRest: n } }));
                      }} />
                    <span>秒</span>
                  </div>
                </label>
                <label className="switch-row">
                  <span>
                    <Volume2 size={17} /> 休息结束声音
                  </span>
                  <input
                    type="checkbox"
                    checked={data.settings.sound}
                    onChange={(e) => {
                      unlockAudio();
                      setData((d) => ({
                        ...d,
                        settings: { ...d.settings, sound: e.target.checked },
                      }));
                    }}
                  />
                </label>
                {isAndroid ? (
                  <AndroidReminderSettings
                    settings={data.settings}
                    onChange={(patch) =>
                      setData((d) => ({
                        ...d,
                        settings: { ...d.settings, ...patch },
                      }))
                    }
                    target={{
                      date: timer?.date ?? selected,
                      exerciseId:
                        timer?.exerciseId ?? day.exercises[0]?.id ?? "",
                    }}
                    notify={notify}
                  />
                ) : (
                  <ReminderSettings
                    settings={data.settings}
                    onChange={(patch) =>
                      setData((d) => ({
                        ...d,
                        settings: { ...d.settings, ...patch },
                      }))
                    }
                    target={{
                      date: timer?.date ?? selected,
                      exerciseId:
                        timer?.exerciseId ?? day.exercises[0]?.id ?? "",
                    }}
                    notify={notify}
                  />
                )}
                <div className="info-box">
                  <CircleHelp size={18} />
                  <p>
                    倒计时结束后，下一组始终由你手动开始。点击通知只会返回对应训练，不会自动开组。支持的浏览器会在训练时保持屏幕常亮。
                  </p>
                </div>
              </section>
              <section className="panel settings-panel">
                <h2>
                  <ArrowDownToLine size={20} /> 数据与备份
                </h2>
                <p>
                  训练和体重记录保存在当前设备中。更换设备或清除应用数据前，请导出备份。
                </p>
                <button className="secondary wide" onClick={() => exportData()}>
                  <ArrowDownToLine size={17} /> 导出全部记录
                </button>
                <button
                  className="secondary wide"
                  onClick={() => fileRef.current?.click()}
                >
                  <ArrowUpFromLine size={17} /> 从备份恢复
                </button>
                <input
                  hidden
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => void importFile(e.target.files?.[0])}
                />
                <p className="subtle">
                  备份包含训练计划、逐组记录、体重、标签和模板。
                </p>
              </section>
            </div>
          )}
          <footer>
            Tsport <span>用记录陪伴每一次进步</span>
            <span>个人训练日志</span>
          </footer>
        </div>
      </main>
      {timer && activeExercise && (
        <div
          className={`timer-dock ${timer.phase}`}
          role="region"
          aria-label="训练计时器"
        >
          <div className="timer-symbol">
            <TimerIcon size={25} />
          </div>
          <button
            className="timer-context"
            onClick={() => {
              chooseDate(timer.date);
              setTab("calendar");
            }}
          >
            <strong>
              {timer.phase === "work"
                ? "本组训练中"
                : timer.phase === "rest"
                  ? (timer.kind === "exercise" ? "动作间休息" : "组间休息")
                  : "准备好，再出发"}
            </strong>
            <span>
              {timer.kind === "exercise" ? "接下来：" : ""}{activeExercise.name} · 已完成 {activeExercise.records.length} 组
            </span>
            {isAndroid && nativeAlarmStatus && (
              <span className="native-alarm-status">{nativeAlarmStatus}</span>
            )}
          </button>
          <div className="timer-digits">
            {timer.phase === "ready" ? "就绪" : formatTime(activeSeconds)}
          </div>
          <div className="timer-controls">
            {timer.phase === "work" ? (
              <button className="lime-button" onClick={() => commitTraining(finishSet(latestData.current, Date.now()))}>
                <Check size={18} /> 结束本组
              </button>
            ) : activeExercise.records.length >= activeExercise.sets ? (
              <>
                <button className="lime-button" onClick={complete}>
                  <Check size={17} /> 完成该动作
                </button>
                <button className="timer-add" onClick={() => start(activeExercise.id, timer.date)}>再加练一组</button>
              </>
            ) : timer.phase === "rest" ? (
              <>
                <button className="timer-add" onClick={() => {
                  const d = latestData.current;
                  if (d.timer) commitTraining({ ...d, timer: { ...d.timer, deadline: d.timer.deadline + 30000 } });
                }}>+30 秒</button>
                <button className="lime-button" onClick={() => {
                  const d = latestData.current;
                  if (d.timer) commitTraining({ ...d, timer: { ...d.timer, phase: "ready" } });
                }}><SkipForward size={16} /> 跳过休息</button>
              </>
            ) : (
              <button className="lime-button" onClick={() => start(activeExercise.id, timer.date)}>
                <Play size={17} /> 开始下一组
              </button>
            )}
          </div>
          {isAndroid && (!data.settings.notifications || !nativeAlarmStatus.includes("已启动")) && (
            <button className="timer-reminder-settings" onClick={() => setTab("settings")}>
              {data.settings.notifications ? "检查提醒权限" : "开启后台提醒"}
            </button>
          )}
          <button
            className="timer-close"
            aria-label="关闭计时"
            onClick={() =>
              timer.phase === "work"
                ? setModal({
                    kind: "confirm",
                    title: "放弃本组计时？",
                    text: "本组尚未完成，不会产生完成记录。已完成的组会保留。",
                    action: () => commitTraining({ ...latestData.current, timer: null }),
                  })
                : commitTraining({ ...latestData.current, timer: null })
            }
          >
            <X size={18} />
          </button>
        </div>
      )}
      {restAlert && (
        <div className="rest-alert" role="status">
          <div>
            <strong>休息结束了</strong>
            <span>准备好后，再开始下一组。</span>
          </div>
          <button className="secondary" onClick={() => openTraining(restAlert)}>
            返回训练
          </button>
          <button
            className="icon-button"
            aria-label="收起休息提醒"
            onClick={() => setRestAlert(null)}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {toast && (
        <div role="status" className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <Modal
          title={
            modal.kind === "exercise"
              ? "编辑训练动作"
              : modal.kind === "weight"
                ? "记录体重"
                : modal.kind === "tags"
                  ? "训练标签"
                  : modal.kind === "templates"
                    ? "我的训练模板"
                    : modal.kind === "saveTemplate"
                      ? "保存训练模板"
                      : modal.kind === "record"
                        ? "修改完成记录"
                        : modal.title
          }
          onClose={() => setModal(null)}
        >
          {modal.kind === "exercise" && (
            <ExerciseForm
              exercise={modal.exercise}
              onSave={(e) => {
                patchDay((d) => ({
                  ...d,
                  exercises: d.exercises.some((x) => x.id === e.id)
                    ? d.exercises.map((x) => x.id === e.id
                      ? { ...e, completed: e.completed && e.records.length >= e.sets }
                      : x)
                    : [...d.exercises, e],
                }));
                setModal(null);
              }}
            />
          )}
          {modal.kind === "weight" && (
            <WeightForm
              selected={selected}
              today={today}
              weights={data.weights}
              onSave={(date, kg) => {
                setData((d) => ({
                  ...d,
                  weights: { ...d.weights, [date]: kg },
                }));
                setModal(null);
                notify("体重已保存");
              }}
            />
          )}
          {modal.kind === "tags" && (
            <>
              <div className="tag-picker">
                {data.tags.map((t) => (
                  <button
                    className={day.tags.includes(t.id) ? "chosen" : ""}
                    key={t.id}
                    style={{ background: t.color }}
                    onClick={() =>
                      patchDay((d) => ({
                        ...d,
                        tags: d.tags.includes(t.id)
                          ? d.tags.filter((id) => id !== t.id)
                          : [...d.tags, t.id],
                      }))
                    }
                  >
                    {t.name}
                    {day.tags.includes(t.id) && <Check size={16} />}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget),
                    name = String(f.get("name")).trim();
                  if (!name) return;
                  if (data.tags.some((t) => t.name === name)) {
                    notify("这个标签已经存在");
                    return;
                  }
                  const tag = {
                    id: uid(),
                    name,
                    color: String(f.get("color")),
                  };
                  setData((d) => ({
                    ...d,
                    tags: [...d.tags, tag],
                    days: {
                      ...d.days,
                      [selected]: {
                        ...(d.days[selected] ?? emptyDay()),
                        tags: [...(d.days[selected]?.tags ?? []), tag.id],
                      },
                    },
                  }));
                  e.currentTarget.reset();
                }}
              >
                <label>
                  自定义标签
                  <input
                    name="name"
                    maxLength={12}
                    placeholder="例如：核心、有氧、全身"
                    required
                  />
                </label>
                <label className="color-label">
                  标签颜色
                  <input name="color" type="color" defaultValue="#e0e8f7" />
                </label>
                <button className="secondary wide" type="submit">
                  <Plus size={16} /> 创建并添加标签
                </button>
              </form>
              <button className="primary wide" onClick={() => setModal(null)}>
                完成
              </button>
            </>
          )}
          {modal.kind === "templates" && (
            <>
              <button
                className="template-row"
                onClick={() => usePlan(samplePlan(data.settings.rest))}
              >
                <span>
                  <strong>胸部训练 · 示例</strong>
                  <small>4 个动作 · 每项 4 × 12 · 可自行调整</small>
                </span>
                <Plus size={19} />
              </button>
              {data.templates.map((t) => (
                <div className="template-item" key={t.id}>
                  <button
                    className="template-row"
                    onClick={() => usePlan(t.day)}
                  >
                    <span>
                      <strong>{t.name}</strong>
                      <small>
                        {t.day.exercises.length} 个动作 · 只复制计划
                      </small>
                    </span>
                    <Plus size={19} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`删除模板${t.name}`}
                    onClick={() =>
                      setModal({
                        kind: "confirm",
                        title: "删除模板？",
                        text: "已安排到日历的训练不受影响。",
                        action: () =>
                          setData((d) => ({
                            ...d,
                            templates: d.templates.filter((x) => x.id !== t.id),
                          })),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {!data.templates.length && (
                <p className="subtle">当天训练安排好后，可保存为自己的模板。</p>
              )}
            </>
          )}
          {modal.kind === "saveTemplate" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = String(
                  new FormData(e.currentTarget).get("name"),
                ).trim();
                if (!name) return;
                setData((d) => ({
                  ...d,
                  templates: [
                    ...d.templates,
                    { id: uid(), name, day: clonePlan(day) },
                  ],
                }));
                setModal(null);
                notify("模板已保存");
              }}
            >
              <label>
                模板名称
                <input
                  required
                  name="name"
                  maxLength={40}
                  placeholder="例如：周一胸部训练"
                />
              </label>
              <p className="subtle">保留动作、目标和标签，不包含已完成记录。</p>
              <button className="primary wide">保存模板</button>
            </form>
          )}
          {modal.kind === "record" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                patchDay((d) => ({
                  ...d,
                  exercises: d.exercises.map((x) =>
                    x.id === modal.exerciseId
                      ? {
                          ...x,
                          records: x.records.map((r) =>
                            r.id === modal.record.id
                              ? {
                                  ...r,
                                  reps: Number(f.get("reps")),
                                  kg: Number(f.get("kg")),
                                }
                              : r,
                          ),
                        }
                      : x,
                  ),
                }));
                setModal(null);
              }}
            >
              <div className="form-grid">
                <label>
                  实际次数
                  <input
                    name="reps"
                    type="number"
                    min="0"
                    max="999"
                    required
                    defaultValue={modal.record.reps}
                  />
                </label>
                <label>
                  实际重量（kg）
                  <input
                    name="kg"
                    type="number"
                    min="0"
                    max="1000"
                    step="0.5"
                    required
                    defaultValue={modal.record.kg}
                  />
                </label>
              </div>
              <p className="subtle">
                本组耗时：
                {modal.record.duration === null
                  ? "未计时"
                  : formatTime(modal.record.duration)}
              </p>
              <button className="primary wide">保存修改</button>
              <button
                className="danger-button wide"
                type="button"
                onClick={() => {
                  patchDay((d) => ({
                    ...d,
                    exercises: d.exercises.map((x) =>
                      x.id === modal.exerciseId
                        ? {
                            ...x,
                            completed: false,
                            records: x.records.filter(
                              (r) => r.id !== modal.record.id,
                            ),
                          }
                        : x,
                    ),
                  }));
                  setModal(null);
                  notify("已撤销这一组");
                }}
              >
                撤销本组记录
              </button>
            </form>
          )}
          {modal.kind === "confirm" && (
            <>
              <p className="confirm-text">{modal.text}</p>
              <div className="modal-actions">
                <button className="secondary" onClick={() => setModal(null)}>
                  取消
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    modal.action();
                    setModal(null);
                  }}
                >
                  确认
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function Stat({
  icon,
  title,
  value,
  unit,
  detail,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  value: string | number;
  unit: string;
  detail: string;
  onClick?: () => void;
}) {
  return (
    <div className="stat-card">
      <div>
        <div className="stat-title">{title}</div>
        <div className="stat-value">
          {value}
          <span>{unit}</span>
        </div>
        <div className="stat-detail">{detail}</div>
      </div>
      {onClick ? (
        <button className="stat-icon" aria-label="记录体重" onClick={onClick}>
          {icon}
        </button>
      ) : (
        <div className="stat-icon">{icon}</div>
      )}
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ExerciseForm({
  exercise,
  onSave,
}: {
  exercise: Exercise;
  onSave: (e: Exercise) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          name = String(f.get("name")).trim();
        if (!name) return;
        onSave({
          ...exercise,
          name,
          sets: Number(f.get("sets")),
          reps: Number(f.get("reps")),
          kg: Number(f.get("kg")),
          seconds: Number(f.get("seconds")),
          rest: Number(f.get("rest")),
        });
      }}
    >
      <label>
        动作名称
        <input
          required
          name="name"
          maxLength={60}
          defaultValue={exercise.name}
        />
      </label>
      <div className="form-grid">
        {[
          ["sets", "目标组数", exercise.sets, 1, 100, 1],
          ["reps", "每组次数", exercise.reps, 1, 999, 1],
          ["kg", "目标重量（kg）", exercise.kg, 0, 1000, 0.5],
          ["seconds", "预计单组（秒）", exercise.seconds, 1, 3600, 1],
          ["rest", "组间休息（秒）", exercise.rest, 0, 3600, 1],
        ].map(([name, label, value, min, max, step]) => (
          <label key={String(name)}>
            {label}
            <input
              required
              name={String(name)}
              type="number"
              min={min}
              max={max}
              step={step}
              defaultValue={value}
            />
          </label>
        ))}
      </div>
      <p className="subtle">
        0 kg 代表徒手；0 秒休息将直接进入等待。调整目标不会修改已完成的组。
      </p>
      <button className="primary wide">保存动作</button>
    </form>
  );
}
function WeightChart({ points }: { points: [string, number][] }) {
  if (!points.length)
    return (
      <div className="chart-empty">
        <Scale size={36} />
        <h3>第一笔记录，就是起点</h3>
        <p>记录体重后，这里会出现你的变化曲线。</p>
      </div>
    );
  const width = 900,
    height = 290,
    pad = 45;
  const vals = points.map((p) => p[1]),
    min = Math.floor(Math.min(...vals) - 1),
    max = Math.ceil(Math.max(...vals) + 1),
    start = parseDate(points[0][0]).getTime(),
    end = parseDate(points.at(-1)![0]).getTime();
  const coords = points.map(([date, kg]) => ({
    date,
    kg,
    x:
      points.length === 1
        ? width / 2
        : pad +
          ((parseDate(date).getTime() - start) / (end - start)) *
            (width - pad * 2),
    y: height - pad - ((kg - min) / (max - min)) * (height - pad * 2),
  }));
  const line = coords.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`体重曲线，共${points.length}笔记录，从${points[0][1]}到${points.at(-1)![1]}公斤`}
      >
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#9bc6ac" stopOpacity=".3" />
            <stop offset="1" stopColor="#9bc6ac" stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: 5 }, (_, i) => {
          const y = pad + (i * (height - pad * 2)) / 4;
          return (
            <g key={i}>
              <line
                x1={pad}
                x2={width - pad}
                y1={y}
                y2={y}
                stroke="#e5eae8"
                strokeDasharray="4 5"
              />
              <text
                x={pad - 12}
                y={y + 5}
                textAnchor="end"
                fill="#7b8581"
                fontSize="13"
              >
                {(max - (i * (max - min)) / 4).toFixed(1)}
              </text>
            </g>
          );
        })}
        {points.length > 1 && (
          <path
            d={`${line} L${coords.at(-1)!.x},${height - pad} L${coords[0].x},${height - pad} Z`}
            fill="url(#fill)"
          />
        )}
        <path
          d={line}
          fill="none"
          stroke="#27765c"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        {coords.map((p) => (
          <g key={p.date}>
            <circle
              cx={p.x}
              cy={p.y}
              r="5"
              fill="#fff"
              stroke="#27765c"
              strokeWidth="2"
            >
              <title>
                {p.date} · {p.kg} kg
              </title>
            </circle>
          </g>
        ))}
        {[coords[0], ...(coords.length > 1 ? [coords.at(-1)!] : [])].map(
          (p) => (
            <text
              key={p.date}
              x={p.x}
              y={height - 12}
              textAnchor="middle"
              fill="#7b8581"
              fontSize="13"
            >
              {p.date}
            </text>
          ),
        )}
      </svg>
      <div className="chart-caption">
        {points[0][0]} — {points.at(-1)![0]} · {points.length} 次记录
      </div>
    </div>
  );
}

function WeightForm({
  selected,
  today,
  weights,
  onSave,
}: {
  selected: string;
  today: string;
  weights: Record<string, number>;
  onSave: (date: string, kg: number) => void;
}) {
  const initial = selected > today ? today : selected;
  const [date, setDate] = useState(initial),
    [kg, setKg] = useState(weights[initial]?.toString() ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(date, Number(kg));
      }}
    >
      <label>
        记录日期
        <input
          name="date"
          aria-label="体重日期"
          type="date"
          required
          max={today}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setKg(weights[e.target.value]?.toString() ?? "");
          }}
        />
      </label>
      <label>
        体重（kg）
        <input
          name="kg"
          aria-label="体重公斤"
          type="number"
          required
          min="1"
          max="500"
          step="0.1"
          placeholder="例如 72.5"
          value={kg}
          onChange={(e) => setKg(e.target.value)}
        />
      </label>
      <p className="subtle">同一天再次保存会更新该天的体重。</p>
      <button className="primary wide" type="submit">
        保存体重
      </button>
    </form>
  );
}
