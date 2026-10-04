import { useState, type ReactNode, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor,
  closestCenter, useSensor, useSensors, type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { Exercise } from "./model";

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const instructions = {
  draggable: "按空格拾起动作，用上下方向键调整顺序，再按空格放下，按 Esc 取消。",
};

export function SortableExercises({ exercises, onMove, children }: {
  exercises: Exercise[];
  onMove: (activeId: string, overId: string) => void;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState<{ id: string; height: number } | null>(null);
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
    useSensor(MouseSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const activeExercise = exercises.find((e) => e.id === dragging?.id);
  const name = (id: string | number) => exercises.find((e) => e.id === id)?.name ?? "动作";
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      accessibility={{
        screenReaderInstructions: instructions,
        announcements: {
          onDragStart: ({ active }) => `已拾起${name(active.id)}。`,
          onDragOver: ({ active, over }) => over
            ? `${name(active.id)}移至第 ${exercises.findIndex((e) => e.id === over.id) + 1} 位。`
            : "请移回动作列表。",
          onDragEnd: ({ active, over }) => over
            ? `${name(active.id)}已放到第 ${exercises.findIndex((e) => e.id === over.id) + 1} 位。`
            : "已取消排序。",
          onDragCancel: () => "已取消排序，原顺序保留。",
        },
      }}
      onDragStart={({ active }) => setDragging({
        id: String(active.id),
        height: document.getElementById(`exercise-${active.id}`)?.getBoundingClientRect().height ?? 150,
      })}
      onDragCancel={() => setDragging(null)}
      onDragEnd={({ active, over }) => {
        setDragging(null);
        if (over && active.id !== over.id) onMove(String(active.id), String(over.id));
      }}
    >
      {exercises.length > 1 && <p className="sort-hint"><GripVertical size={14} />长按动作卡片，上下拖动排序</p>}
      <SortableContext items={exercises.map((e) => e.id)} strategy={verticalListSortingStrategy}>
        <div className={`exercise-list${dragging ? " sorting" : ""}`}>{children}</div>
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={null} zIndex={60}>
          {activeExercise && <div
            className="exercise-drag-preview"
            style={{ height: dragging?.height }}
            aria-hidden="true"
          >
            <div><GripVertical size={19} /><strong>{activeExercise.name}</strong></div>
            <span>目标 {activeExercise.sets} × {activeExercise.reps} · 已完成 {activeExercise.records.length} 组</span>
            <small>拖到目标位置后松手</small>
          </div>}
        </DragOverlay>, document.body,
      )}
    </DndContext>
  );
}

// A short swipe scrolls normally; a long press can start on the name or card body.
// Training, record and delete controls keep their ordinary touch/click behavior.
function canDrag(event: SyntheticEvent) {
  const target = event.target;
  return target instanceof Element &&
    (!target.closest("button, input, textarea, select, a, summary, [contenteditable]") ||
      !!target.closest(".exercise-name, .exercise-drag-handle"));
}

export function SortableExerciseCard({ exercise, focused, children }: {
  exercise: Exercise;
  focused: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: exercise.id });
  return (
    <article
      ref={setNodeRef}
      id={`exercise-${exercise.id}`}
      className={`exercise-card${focused ? " focused" : ""}${isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onTouchStart={(event) => { if (canDrag(event)) listeners?.onTouchStart?.(event); }}
      onMouseDown={(event) => { if (canDrag(event)) listeners?.onMouseDown?.(event); }}
      onContextMenu={(event) => { if (canDrag(event)) event.preventDefault(); }}
    >
      {children(<button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        onKeyDown={(event) => listeners?.onKeyDown?.(event)}
        className="exercise-drag-handle"
        aria-label={`调整${exercise.name}顺序`}
        title="长按拖动排序；键盘按空格后用上下键移动"
      ><GripVertical size={17} /></button>)}
    </article>
  );
}
