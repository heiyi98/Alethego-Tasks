import type { CalendarDate } from '../schedule/calendar-date';
import { endOfDay } from '../time/zoned-time';

/**
 * 子任务：对一个任务内容的拆分，只有标题和勾选；只有一层，没有时间、重要性、RACI、任务关系，
 * 不单独出现在矩阵、甘特图、今日里。删除只做标记（deletedAt），循环任务过去各次的历史保持原样。
 */
export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  position: number;
  createdAt: Date;
  deletedAt: Date | null;
}

/** 一个勾选：普通任务 occurrenceDate 为 null；循环任务每一次（按那一次的日期）各自勾选 */
export interface SubtaskCheck {
  subtaskId: string;
  occurrenceDate: CalendarDate | null;
}

/**
 * 某个子任务算不算某一次里的：asOf 是这一次的清单定格的时刻（见 occurrenceListAsOf），
 * "那时已经有、那时还没删"的才算；asOf 为 null（普通任务）时只看有没有删除。
 * 所以改清单只影响以后，过去各次保持原样。数据库的 subtask_applies 按日期放宽了一天，精确判断在这里。
 */
export function subtaskApplies(
  subtask: Pick<Subtask, 'createdAt' | 'deletedAt'>,
  asOf: Date | null,
): boolean {
  if (asOf === null) return subtask.deletedAt === null;
  return (
    subtask.createdAt.getTime() <= asOf.getTime() &&
    (subtask.deletedAt === null || subtask.deletedAt.getTime() > asOf.getTime())
  );
}

/**
 * 某一次的清单定格的时刻：那一天（用户本地）结束的时刻；提前完成的，定格在完成的时刻
 * （之后改清单不影响它）。还没到的那一次随当前清单变化。
 */
export function occurrenceListAsOf(
  occurrence: { occurrenceDate: CalendarDate; status?: string; completedAt?: Date | null },
  timeZone: string,
): Date {
  const end = endOfDay(occurrence.occurrenceDate, timeZone);
  const { status, completedAt } = occurrence;
  return status === 'completed' && completedAt && completedAt < end ? completedAt : end;
}

/** 某一次（普通任务 asOf 为 null）的子任务清单，按顺序 */
export function subtasksFor<T extends Subtask>(subtasks: readonly T[], asOf: Date | null): T[] {
  return subtasks
    .filter((s) => subtaskApplies(s, asOf))
    .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
}

export function isSubtaskChecked(
  checks: readonly SubtaskCheck[],
  subtaskId: string,
  occurrenceDate: CalendarDate | null,
): boolean {
  return checks.some((c) => c.subtaskId === subtaskId && c.occurrenceDate === occurrenceDate);
}

/** 进度，例如 2/5；没有子任务时 total 为 0。普通任务 occurrenceDate、asOf 都为 null */
export function subtaskProgress(
  subtasks: readonly Subtask[],
  checks: readonly SubtaskCheck[],
  occurrenceDate: CalendarDate | null,
  asOf: Date | null,
): { done: number; total: number } {
  const list = subtasksFor(subtasks, asOf);
  return {
    done: list.filter((s) => isSubtaskChecked(checks, s.id, occurrenceDate)).length,
    total: list.length,
  };
}
