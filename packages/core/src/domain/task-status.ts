import type { Task } from './task';

/** 普通（非循环）任务的派生状态，对应主列表的状态筛选。 */
export type TaskStatus = 'todo' | 'missed' | 'completed';

/**
 * 由已有字段派生任务状态，不需要额外存储：
 * - completed_at 非空 → 已完成
 * - deadline_at 已过且未完成 → 已错过（超过截止时间的那一刻即成立，与矩阵的 3 天展示宽限期无关）
 * - 其余 → 待办
 */
export function deriveTaskStatus(
  task: Pick<Task, 'deadlineAt' | 'completedAt'>,
  now: Date,
): TaskStatus {
  if (task.completedAt) return 'completed';
  if (task.deadlineAt && task.deadlineAt.getTime() < now.getTime()) return 'missed';
  return 'todo';
}
