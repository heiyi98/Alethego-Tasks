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
}: {
  task: Task;
  categories: readonly Category[];
  now: Date;
  timeZone: string;
  onToggleComplete: (task: Task) => void;
}) {
  const status = deriveTaskStatus(task, now);
  return (
    <li className={`task-row task-${status}`}>
      <input
        type="checkbox"
        className="task-check"
        aria-label={`${status === 'completed' ? '取消完成' : '完成'}：${task.title}`}
        checked={status === 'completed'}
        onChange={() => onToggleComplete(task)}
      />
      <Link href={`/tasks/${task.id}`} className="task-main">
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {task.deadlineAt && (
            <span className="task-deadline">
              {status === 'missed' && '已错过 · '}
              {formatDeadline(task.deadlineAt, now, timeZone)}
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
