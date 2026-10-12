import type { ImportanceLevel } from '../domain/importance';
import type { RecurrenceOccurrence } from '../domain/occurrence';
import type { Task } from '../domain/task';
import type { CalendarDate } from '../schedule/calendar-date';
import type { MatrixCandidate } from '../quadrant/matrix-candidate';
import { resolveRepresentativeInstance, seriesFromTask } from '../recurrence/recurrence-engine';
import type { EvaluationContext } from '../time/zoned-time';
import { calculateUrgency } from '../urgency/urgency-calculator';

/**
 * 任务当前的「一个代表」：把普通任务与循环任务收敛成同一种形状，
 * 这里是唯一区分两者的地方，下游（矩阵、象限列表）不再感知循环。
 */
export interface TaskRepresentative {
  taskId: string;
  importanceLevel: ImportanceLevel;
  deadlineOn: CalendarDate | null;
  /** 循环任务代表实例的日期；普通任务为 null */
  occurrenceDate: CalendarDate | null;
}

/**
 * 解析任务的代表：
 * - 已软删除的任务没有代表。
 * - 普通任务：任务本身；已完成的任务没有代表（不进入矩阵）。
 * - 循环任务：日期未过去的最早未完成实例，各实例继承任务的重要性；序列已结束时没有代表。
 */
export function resolveTaskRepresentative(
  task: Task,
  occurrences: readonly Pick<RecurrenceOccurrence, 'occurrenceDate' | 'status'>[],
  context: EvaluationContext,
): TaskRepresentative | null {
  if (task.deletedAt) return null;
  const series = seriesFromTask(task);
  if (series) {
    const instance = resolveRepresentativeInstance(series, occurrences, context);
    if (!instance) return null;
    return {
      taskId: task.id,
      importanceLevel: task.importanceLevel,
      deadlineOn: instance.occurrenceDate,
      occurrenceDate: instance.occurrenceDate,
    };
  }

  if (task.completedAt) return null;
  return {
    taskId: task.id,
    importanceLevel: task.importanceLevel,
    deadlineOn: task.deadlineOn,
    occurrenceDate: null,
  };
}

export function toMatrixCandidate(
  representative: TaskRepresentative,
  context: EvaluationContext,
): MatrixCandidate {
  return {
    importanceLevel: representative.importanceLevel,
    urgency: calculateUrgency(representative.deadlineOn, context),
  };
}
