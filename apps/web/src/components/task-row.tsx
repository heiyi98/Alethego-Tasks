'use client';

import { deriveTaskStatus, type Category, type Task, type TaskStatus } from '@alethego/core';

import { CategoryDot } from './category-dot';
import { usePanels } from './panel-provider';
import { StarButton } from './task-editor';
import { useTaskData } from './task-data-provider';
import { EditPanel } from './task-panels';
import { formatDeadline, importanceLabel, recurrenceLabel } from '@/lib/format';

export function TaskRow({
  task,
  categories,
  now,
  timeZone,
  onToggleComplete,
  deadline = task.deadlineAt,
  status = task.recurrenceRule ? 'todo' : deriveTaskStatus(task, now),
}: {
  task: Task;
  categories: readonly Category[];
  now: Date;
  timeZone: string;
  /**
   * 勾选完成。普通任务：切换任务本身的完成状态；循环任务：完成当前这一次实例。
   * 不传时为只读行（不显示勾选框）。
   */
  onToggleComplete?: (task: Task) => void;
  /** 显示的截止时间；循环任务传代表实例的时间 */
  deadline?: Date | null;
  /** 列表状态；循环任务的状态不由任务本身的截止 / 完成时间决定 */
  status?: TaskStatus;
}) {
  const { active, open } = usePanels();
  const { toggleStar } = useTaskData();
  // 列表中点击任务：标题所在的这一行留在原位并变为可编辑，面板从它下方展开；再次点击收起
  const expanded =
    active?.kind === 'edit' && active.taskId === task.id && active.surface === 'inline';
  const recurring = task.recurrenceRule !== null;
  const checkboxLabel = (completed: boolean) =>
    recurring ? `完成本次：${task.title}` : `${completed ? '取消完成' : '完成'}：${task.title}`;

  const meta = (
    <span className="task-meta">
      {deadline && (
        <span className="task-deadline">
          {recurring && '本次 '}
          {formatDeadline(deadline, now, timeZone)}
        </span>
      )}
      {recurring && (
        <span className="task-recurrence">↻ {recurrenceLabel(task.recurrenceRule!, timeZone)}</span>
      )}
      {task.importanceLevel > 0 && (
        <span className="task-importance">重要性 {importanceLabel(task.importanceLevel)}</span>
      )}
      {categories.map((category) => (
        <span key={category.id} className="task-category">
          <CategoryDot color={category.color} />
          {category.name}
        </span>
      ))}
    </span>
  );

  if (expanded) {
    return (
      <li className={`task-item task-item-open task-${status}`}>
        <EditPanel
          taskId={task.id}
          surface="inline"
          focusTitle={active.focusTitle ?? false}
          row={{
            title: task.title,
            meta,
            checkbox: (form, onChange) =>
              onToggleComplete && (
                <input
                  type="checkbox"
                  className="task-check"
                  aria-label={checkboxLabel(form.completed)}
                  // 普通任务绑定面板里的完成状态（随自动保存写入）；循环任务完成当前这一次实例
                  checked={!recurring && form.completed}
                  disabled={recurring && status === 'completed'}
                  onChange={() =>
                    recurring ? onToggleComplete(task) : onChange({ completed: !form.completed })
                  }
                />
              ),
          }}
        />
      </li>
    );
  }

  return (
    <li className={`task-item task-${status}`}>
      {/* 点任务名：展开并让标题进入编辑；点行内其他区域（勾选框和星标除外）：只展开 */}
      <div
        className="task-row"
        data-panel-anchor
        onClick={(event) => {
          const target = event.target as Element;
          if (target.closest('input, .row-actions')) return;
          open({
            kind: 'edit',
            taskId: task.id,
            surface: 'inline',
            focusTitle: Boolean(target.closest('.task-title')),
          });
        }}
      >
        {onToggleComplete && (
          <input
            type="checkbox"
            className="task-check"
            aria-label={checkboxLabel(status === 'completed')}
            // 循环任务的勾选框永远代表"当前这一次"，勾选后代表实例顺延到下一次
            checked={!recurring && status === 'completed'}
            disabled={recurring && status === 'completed'}
            onChange={() => onToggleComplete(task)}
          />
        )}
        <button type="button" className="task-main" aria-expanded={false} data-task-id={task.id}>
          <span className="task-title">{task.title}</span>
          {meta}
        </button>
        <div className="row-actions">
          <StarButton starred={task.isStarred} onToggle={() => void toggleStar(task)} />
        </div>
      </div>
    </li>
  );
}
