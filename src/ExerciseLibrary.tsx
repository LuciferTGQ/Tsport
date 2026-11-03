import { useState } from "react";
import { Edit3, Plus, Search, Trash2 } from "lucide-react";
import { exerciseCategories, type ExerciseCategory, type SavedExercise } from "./model";
import "./exerciseLibrary.css";

export default function ExerciseLibrary({ items, onAdd, onEdit, onDelete, onCreate }: {
  items: SavedExercise[];
  onAdd: (item: SavedExercise) => void;
  onEdit: (item: SavedExercise) => void;
  onDelete: (item: SavedExercise) => void;
  onCreate: () => void;
}) {
  const [category, setCategory] = useState<ExerciseCategory | "全部">("全部");
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const shown = items.filter((item) =>
    (category === "全部" || item.category === category) &&
    item.exercise.name.toLocaleLowerCase().includes(query));

  return (
    <div className="exercise-library">
      <p className="subtle">保存常用动作的组数、次数和逐组重量，随时添加到所选日期。</p>
      <button type="button" className="secondary wide library-create" onClick={onCreate}>
        <Plus size={17} />新建动作
      </button>
      <div className="library-search">
        <Search size={17} aria-hidden="true" />
        <input type="search" aria-label="搜索已保存动作" placeholder="搜索动作名称"
          value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="library-categories" role="group" aria-label="动作分类筛选">
        {(["全部", ...exerciseCategories] as const).map((item) => (
          <button type="button" key={item} aria-pressed={category === item}
            onClick={() => setCategory(item)}>{item}</button>
        ))}
      </div>
      <p className="library-count">{shown.length} 个动作</p>
      {shown.length === 0 ? (
        <div className="library-empty">
          <strong>{items.length ? "没有找到动作" : "动作库还是空的"}</strong>
          <p>{items.length ? "试试其他分类或动作名称。" : "新建动作时勾选「同时保存到动作库」，或在已有动作上点「存入动作库」。"}</p>
        </div>
      ) : (
        <div className="library-list">
          {shown.map((item) => (
            <article key={item.id} className="library-item" aria-label={`已保存动作：${item.exercise.name}`}>
              <div className="library-item-heading">
                <strong>{item.exercise.name}</strong><span>{item.category}</span>
              </div>
              <p>{item.exercise.sets} 组 × {item.exercise.reps} 次 · 休息 {item.exercise.setRests ? item.exercise.setRests.join(" / ") : item.exercise.rest} 秒</p>
              <p className="library-weights">
                {item.exercise.targetWeights
                  ? `逐组重量：${item.exercise.targetWeights.join(" / ")} kg`
                  : `每组重量：${item.exercise.kg} kg`}
              </p>
              <div className="library-item-actions">
                <button type="button" className="secondary" aria-label={`添加${item.exercise.name}到当天`}
                  onClick={() => onAdd(item)}><Plus size={15} />添加到当天</button>
                <button type="button" className="text-button" aria-label={`编辑已保存动作${item.exercise.name}`}
                  onClick={() => onEdit(item)}><Edit3 size={15} />编辑</button>
                <button type="button" className="text-button" aria-label={`删除已保存动作${item.exercise.name}`}
                  onClick={() => onDelete(item)}><Trash2 size={15} />删除</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
