'use client';

import { deriveTaskStatus, type Category, type Task, type TaskStatus } from '@alethego/core';
import Link from 'next/link';

import { CategoryDot } from './category-dot';
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
  const recurring = task.recurrenceRule !== null;
  const checkboxLabel = recurring
    ? `完成本次：${task.title}`
    : `${status === 'completed' ? '取消完成' : '完成'}：${task.title}`;

  return (
    <li className={`task-row task-${status}`}>
      {onToggleComplete && (
        <input
          type="checkbox"
          className="task-check"
          aria-label={checkboxLabel}
          // 循环任务的勾选框永远代表"当前这一次"，勾选后代表实例顺延到下一次
          checked={!recurring && status === 'completed'}
          disabled={recurring && status === 'completed'}
          onChange={() => onToggleComplete(task)}
        />
      )}
      <Link href={`/tasks/${task.id}`} className="task-main">
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {deadline && (
            <span className="task-deadline">
              {status === 'missed' && '已错过 · '}
              {recurring && '本次 '}
              {formatDeadline(deadline, now, timeZone)}
            </span>
          )}
          {recurring && (
            <span className="task-recurrence">
              ↻ {recurrenceLabel(task.recurrenceRule!, timeZone)}
            </span>
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
      </Link>
    </li>
  );
}
