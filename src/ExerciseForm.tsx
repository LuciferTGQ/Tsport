import { useState } from "react";
import { exerciseCategories, type Exercise, type ExerciseCategory } from "./model";
import "./exerciseLibrary.css";

export default function ExerciseForm({
  exercise,
  onSave,
  libraryMode = false,
  initialCategory = "其他",
}: {
  exercise: Exercise;
  onSave: (exercise: Exercise, category?: ExerciseCategory) => void;
  libraryMode?: boolean;
  initialCategory?: ExerciseCategory;
}) {
  const [sets, setSets] = useState(String(exercise.sets));
  const [kg, setKg] = useState(String(exercise.kg));
  const [rest, setRest] = useState(String(exercise.rest));
  const [perSetRest, setPerSetRest] = useState(!!exercise.setRests);
  const [rests, setRests] = useState<string[]>(exercise.setRests?.map(String) ?? []);
  const [perSet, setPerSet] = useState(!!exercise.targetWeights);
  // Keep hidden rows while changing the set count, so shrinking then expanding
  // the form does not discard weights the user has already entered.
  const [weights, setWeights] = useState<string[]>(exercise.targetWeights?.map(String) ?? []);
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [category, setCategory] = useState<ExerciseCategory>(initialCategory);
  const count = Math.max(0, Math.min(100, Math.floor(Number(sets) || 0)));

  return (
    <form
      className="exercise-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const name = String(form.get("name")).trim();
        if (!name) return;
        onSave({
          ...exercise,
          name,
          sets: Number(sets),
          reps: Number(form.get("reps")),
          kg: Number(kg),
          seconds: Number(form.get("seconds")),
          rest: Number(rest),
          setRests: perSetRest
            ? Array.from({ length: count }, (_, index) => Number(rests[index] ?? rest))
            : undefined,
          targetWeights: perSet
            ? Array.from({ length: count }, (_, index) => Number(weights[index] ?? kg))
            : undefined,
        }, libraryMode || saveToLibrary ? category : undefined);
      }}
    >
      <label>
        动作名称
        <input required name="name" maxLength={60} defaultValue={exercise.name} />
      </label>
      <div className="form-grid">
        <label>
          目标组数
          <input required name="sets" type="number" min="1" max="100" step="1"
            inputMode="numeric" value={sets} onChange={(event) => {
              const value = event.target.value;
              setSets(value);
              if (perSetRest) {
                const nextCount = Math.max(0, Math.min(100, Math.floor(Number(value) || 0)));
                setRests((current) => Array.from({ length: Math.max(nextCount, current.length) },
                  (_, index) => current[index] ?? rest));
              }
              if (perSet) {
                const nextCount = Math.max(0, Math.min(100, Math.floor(Number(value) || 0)));
                setWeights((current) => Array.from({ length: Math.max(nextCount, current.length) },
                  (_, index) => current[index] ?? kg));
              }
            }} />
        </label>
        <label>
          每组次数
          <input required name="reps" type="number" min="1" max="999" step="1"
            inputMode="numeric" defaultValue={exercise.reps} />
        </label>
        <label>
          目标重量（kg）
          <input required name="kg" type="number" min="0" max="1000" step="0.01"
            inputMode="decimal" value={kg} onChange={(event) => setKg(event.target.value)} />
        </label>
        <label>
          预计单组（秒）
          <input required name="seconds" type="number" min="1" max="3600" step="1"
            inputMode="numeric" defaultValue={exercise.seconds} />
        </label>
        <label>
          组间休息（秒）
          <input required name="rest" type="number" min="0" max="3600" step="1"
            inputMode="numeric" value={rest} onChange={(event) => setRest(event.target.value)} />
        </label>
      </div>
      <label className="exercise-option">
        <input type="checkbox" checked={perSet} onChange={(event) => {
          const enabled = event.target.checked;
          if (enabled) setWeights((current) => Array.from({ length: Math.max(count, current.length) },
            (_, index) => current[index] ?? kg));
          setPerSet(enabled);
        }} />
        每组单独设置重量
      </label>
      {perSet && (
        <section className="set-weight-editor" aria-label="逐组目标重量">
          <div className="set-weight-heading">
            <span>每组目标 · kg</span>
            <button type="button" className="text-button"
              disabled={kg === "" || !Number.isFinite(Number(kg)) || Number(kg) < 0 || Number(kg) > 1000}
              onClick={() => setWeights((current) => Array.from({ length: Math.max(count, current.length) }, () => kg))}>
              应用到全部组
            </button>
          </div>
          <p className="set-weight-help">上方目标重量用于新增组；点「应用到全部组」可统一修改。</p>
          <div className="set-weight-grid">
            {Array.from({ length: count }, (_, index) => (
              <label key={index}>
                第 {index + 1} 组
                <input required type="number" min="0" max="1000" step="0.01" inputMode="decimal"
                  aria-label={`第 ${index + 1} 组目标重量（kg）`}
                  value={weights[index] ?? kg}
                  onChange={(event) => {
                    const value = event.target.value;
                    setWeights((current) => {
                      const next = [...current];
                      next[index] = value;
                      return next;
                    });
                  }} />
              </label>
            ))}
          </div>
          <p className="subtle">可设置递增或递减组；加练时沿用最后一组重量。</p>
        </section>
      )}
      <label className="exercise-option">
        <input type="checkbox" checked={perSetRest} onChange={(event) => {
          const enabled = event.target.checked;
          if (enabled) setRests((current) => Array.from({ length: Math.max(count, current.length) },
            (_, index) => current[index] ?? rest));
          setPerSetRest(enabled);
        }} />
        每组单独设置休息
      </label>
      {perSetRest && (
        <section className="set-weight-editor" aria-label="逐组休息时间">
          <div className="set-weight-heading">
            <span>每组结束后休息 · 秒</span>
            <button type="button" className="text-button"
              disabled={rest === "" || !Number.isInteger(Number(rest)) || Number(rest) < 0 || Number(rest) > 3600}
              onClick={() => setRests((current) => Array.from({ length: Math.max(count, current.length) }, () => rest))}>
              休息应用到全部组
            </button>
          </div>
          <p className="set-weight-help">上方组间休息用于新增组；后面的组可以设置更长休息。</p>
          <div className="set-weight-grid">
            {Array.from({ length: count }, (_, index) => (
              <label key={index}>
                第 {index + 1} 组后
                <input required type="number" min="0" max="3600" step="1" inputMode="numeric"
                  aria-label={`第 ${index + 1} 组后休息（秒）`}
                  value={rests[index] ?? rest}
                  onChange={(event) => {
                    const value = event.target.value;
                    setRests((current) => {
                      const next = [...current];
                      next[index] = value;
                      return next;
                    });
                  }} />
              </label>
            ))}
          </div>
          <p className="subtle">0 秒直接进入等待；加练沿用最后一组休息。修改不改变正在进行的休息，完成动作后使用偏好设置中的动作间休息。</p>
        </section>
      )}
      {!libraryMode && <label className="exercise-option">
        <input type="checkbox" checked={saveToLibrary}
          onChange={(event) => setSaveToLibrary(event.target.checked)} />
        同时保存到动作库
      </label>}
      {(libraryMode || saveToLibrary) && <label>
        动作分类
        <select name="category" aria-label="动作分类" value={category}
          onChange={(event) => setCategory(event.target.value as ExerciseCategory)}>
          {exerciseCategories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>}
      <p className="subtle">
        {libraryMode
          ? "保存到动作库不会修改当天计划或历史记录。下次添加时可按分类找到。"
          : "0 kg 代表徒手；0 秒休息将直接进入等待。调整目标不会修改已完成的组。"}
      </p>
      <button className="primary wide" type="submit">{libraryMode ? "保存到动作库" : "保存动作"}</button>
    </form>
  );
}
