import type { RecurrenceOccurrence } from '../domain/occurrence';
import type { Task } from '../domain/task';
import type { CalendarDate } from '../schedule/calendar-date';
import { resolveRepresentativeInstance, seriesFromTask } from '../recurrence/recurrence-engine';
import type { EvaluationContext } from '../time/zoned-time';

/** 列表排序所需的最小字段。 */
export interface ListSortable {
  id: string;
  /** 用于排序的截止日期；null 表示无截止日期 */
  deadlineOn: CalendarDate | null;
  createdAt: Date;
}

/**
 * 列表默认排序：截止日期从近到远，无截止日期的排最后；
 * 截止日期相同时新建的在前，最后按 id 保证顺序稳定。
 */
export function compareByDeadline(a: ListSortable, b: ListSortable): number {
  if (a.deadlineOn && b.deadlineOn) {
    if (a.deadlineOn !== b.deadlineOn) return a.deadlineOn < b.deadlineOn ? -1 : 1;
  } else if (a.deadlineOn) {
    return -1;
  } else if (b.deadlineOn) {
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
 * 任务在列表中用于排序的截止日期：
 * 普通任务取截止日期；循环任务取当前代表实例的日期（序列已结束则视为无截止日期）。
 */
export function listDeadlineOf(
  task: Task,
  occurrences: readonly Pick<RecurrenceOccurrence, 'occurrenceDate' | 'status'>[],
  context: EvaluationContext,
): CalendarDate | null {
  const series = seriesFromTask(task);
  if (!series) return task.deadlineOn;
  return resolveRepresentativeInstance(series, occurrences, context)?.occurrenceDate ?? null;
}
