import {
  reconcileOccurrences,
  resolveRepresentativeInstance,
  seriesFromTask,
  type EvaluationContext,
  type RecurrenceOccurrence,
  type Task,
} from '@alethego/core';

import type { IOccurrenceRepository } from '../interfaces/repositories';

/**
 * 循环任务实例记录的同步：由 RecurrenceEngine 判定，仓储落库。
 * 归档允许滞后，因此在读取任务时顺带执行即可（列表 / 矩阵 / 详情 / 历史页）。
 * 返回同步后的全部记录。循环开关关闭的任务只读取历史记录，不再生成新记录。
 */
export async function syncOccurrences(
  occurrences: IOccurrenceRepository,
  task: Task,
  context: EvaluationContext,
): Promise<RecurrenceOccurrence[]> {
  const existing = await occurrences.listByTask(task.id);
  const series = seriesFromTask(task);
  if (!series) return existing;
  const result = reconcileOccurrences(series, existing, context);
  if (result.toCreate.length === 0 && result.toMarkMissed.length === 0) return existing;
  await occurrences.applyReconcile(task.id, result);
  return occurrences.listByTask(task.id);
}

/**
 * 完成循环任务的"当前代表实例"（日期未过去的最早未完成实例），而不是写任务本身的 completed_at。
 * 代表实例可能还没有记录（例如提前完成下一次），此时直接建一条已完成记录。
 * 返回被完成的实例记录；序列已结束时返回 null。
 */
export async function completeCurrentOccurrence(
  occurrences: IOccurrenceRepository,
  task: Task,
  records: readonly RecurrenceOccurrence[],
  context: EvaluationContext,
): Promise<RecurrenceOccurrence | null> {
  const series = seriesFromTask(task);
  if (!series) return null;
  const instance = resolveRepresentativeInstance(series, records, context);
  if (!instance) return null;
  return occurrences.setStatusByDate(task.id, instance.occurrenceAt, 'completed', context.now);
}
