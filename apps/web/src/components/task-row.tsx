'use client';

import { deriveTaskStatus, type Category, type Task } from '@alethego/core';
import Link from 'next/link';

import { CategoryDot } from './category-dot';
import { formatDeadline, importanceLabel } from '@/lib/format';

export function TaskRow({
  task,
  categories,
  now,
  timeZone,
  onToggleComplete,
  deadline = task.deadlineAt,
}: {
  task: Task;
  categories: readonly Category[];
  now: Date;
  timeZone: string;
  /** 不传时为只读行（不显示完成勾选框） */
  onToggleComplete?: (task: Task) => void;
  /** 显示的截止时间；循环任务传代表实例的时间 */
  deadline?: Date | null;
}) {
  const status = deriveTaskStatus(task, now);
  return (
    <li className={`task-row task-${status}`}>
      {onToggleComplete && (
        <input
          type="checkbox"
          className="task-check"
          aria-label={`${status === 'completed' ? '取消完成' : '完成'}：${task.title}`}
          checked={status === 'completed'}
          onChange={() => onToggleComplete(task)}
        />
      )}
      <Link href={`/tasks/${task.id}`} className="task-main">
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {deadline && (
            <span className="task-deadline">
              {status === 'missed' && '已错过 · '}
              {formatDeadline(deadline, now, timeZone)}
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
