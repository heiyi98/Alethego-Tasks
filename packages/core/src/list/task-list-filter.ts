import type { RecurrenceOccurrence } from '../domain/occurrence';
import type { Task } from '../domain/task';
import { deriveTaskStatus } from '../domain/task-status';
import type { EvaluationContext } from '../time/zoned-time';
import { listDeadlineOf, sortByDeadline } from './task-list-order';

/** 主列表状态筛选：待办 / 已错过 / 已完成 / 全部。 */
export type StatusFilter = 'todo' | 'missed' | 'completed' | 'all';

export const STATUS_FILTERS: readonly StatusFilter[] = ['todo', 'missed', 'completed', 'all'];

/** 默认视图：全部待办。 */
export const DEFAULT_STATUS_FILTER: StatusFilter = 'todo';

/** 状态筛选与分类筛选正交组合。 */
export interface TaskListFilter {
  status: StatusFilter;
  /** 点亮的分类；为空表示不按分类筛选（总览） */
  categoryIds: readonly string[];
}

export function matchesStatusFilter(
  task: Pick<Task, 'deadlineAt' | 'completedAt'>,
  filter: StatusFilter,
  now: Date,
): boolean {
  return filter === 'all' || deriveTaskStatus(task, now) === filter;
}

/** 分类多选：命中其一即显示（逻辑或）；未点亮任何分类时不筛选。 */
export function matchesCategoryFilter(
  taskCategoryIds: readonly string[],
  selectedCategoryIds: readonly string[],
): boolean {
  if (selectedCategoryIds.length === 0) return true;
  return selectedCategoryIds.some((id) => taskCategoryIds.includes(id));
}

export interface TaskListSources {
  tasks: readonly Task[];
  /** taskId → 分类 id 列表 */
  categoryIdsByTask: ReadonlyMap<string, readonly string[]>;
  /** taskId → 循环实例记录；不传时循环任务按规则计算代表实例 */
  occurrencesByTask?: ReadonlyMap<string, readonly RecurrenceOccurrence[]>;
}

/** 主列表：去掉已删除任务，应用状态 + 分类筛选，再按截止时间从近到远排序（无截止时间排最后）。 */
export function buildTaskList(
  sources: TaskListSources,
  filter: TaskListFilter,
  context: EvaluationContext,
): Task[] {
  const rows = sources.tasks
    .filter((task) => !task.deletedAt)
    .filter((task) => matchesStatusFilter(task, filter.status, context.now))
    .filter((task) =>
      matchesCategoryFilter(sources.categoryIdsByTask.get(task.id) ?? [], filter.categoryIds),
    )
    .map((task) => ({
      id: task.id,
      createdAt: task.createdAt,
      deadlineAt: listDeadlineOf(task, sources.occurrencesByTask?.get(task.id) ?? [], context),
      task,
    }));
  return sortByDeadline(rows).map((row) => row.task);
}
