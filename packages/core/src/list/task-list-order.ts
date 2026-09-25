import type { RecurrenceOccurrence } from '../domain/occurrence';
import type { Task } from '../domain/task';
import { resolveRepresentativeInstance, seriesFromTask } from '../recurrence/recurrence-engine';
import type { EvaluationContext } from '../time/zoned-time';

/** 列表排序所需的最小字段。 */
export interface ListSortable {
  id: string;
  /** 用于排序的截止时间；null 表示无截止时间 */
  deadlineAt: Date | null;
  createdAt: Date;
}

/**
 * 列表默认排序：截止时间从近到远，无截止时间的排最后；
 * 截止时间相同时新建的在前，最后按 id 保证顺序稳定。
 */
export function compareByDeadline(a: ListSortable, b: ListSortable): number {
  if (a.deadlineAt && b.deadlineAt) {
    const diff = a.deadlineAt.getTime() - b.deadlineAt.getTime();
    if (diff !== 0) return diff;
  } else if (a.deadlineAt) {
    return -1;
  } else if (b.deadlineAt) {
    return 1;
  }
  const created = b.createdAt.getTime() - a.createdAt.getTime();
  if (created !== 0) return created;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortByDeadline<T extends ListSortable>(items: readonly T[]): T[] {
  return [...items].sort(compareByDeadline);
}

/**
 * 任务在列表中用于排序的截止时间：
 * 普通任务取 deadline_at；循环任务取当前代表实例的时间（序列已结束则视为无截止时间）。
 */
export function listDeadlineOf(
  task: Task,
  occurrences: readonly Pick<RecurrenceOccurrence, 'occurrenceDate' | 'status'>[],
  context: EvaluationContext,
): Date | null {
  const series = seriesFromTask(task);
  if (!series) return task.deadlineAt;
  return resolveRepresentativeInstance(series, occurrences, context)?.occurrenceAt ?? null;
}
