import type { CalendarDate } from '../schedule/calendar-date';
import type { Task } from './task';

/** 普通（非循环）任务的派生状态，对应主列表的状态筛选。 */
export type TaskStatus = 'todo' | 'missed' | 'pending' | 'completed';

/**
 * 由已有字段派生任务状态，不需要额外存储：
 * - completed_at 非空且已确认 → 已完成
 * - completed_at 非空但还没确认（管理组：R 标记完成、等 A 确认）→ 待确认；待确认期间截止日期过了也不算已错过
 * - 截止日期已过（那一天过完，按用户本地日期）且未完成 → 已错过（与矩阵的 3 天展示宽限期无关）
 * - 其余 → 待办
 * 没有 confirmedAt 字段的旧数据视为完成即确认。
 */
export function deriveTaskStatus(
  task: Pick<Task, 'deadlineOn' | 'completedAt'> & Partial<Pick<Task, 'confirmedAt'>>,
  today: CalendarDate,
): TaskStatus {
  if (task.completedAt) return task.confirmedAt === null ? 'pending' : 'completed';
  if (task.deadlineOn && task.deadlineOn < today) return 'missed';
  return 'todo';
}
