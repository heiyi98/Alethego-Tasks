import type { RecurrenceOccurrence } from '../domain/occurrence';
import type { Task } from '../domain/task';
import { deriveTaskStatus, type TaskStatus } from '../domain/task-status';
import { resolveRepresentativeInstance, seriesFromTask } from '../recurrence/recurrence-engine';
import type { EvaluationContext } from '../time/zoned-time';
import { listDeadlineOf, sortByDeadline } from './task-list-order';

/**
 * 范围（左侧菜单上区，单选）：全部 / 收藏。收藏 = 所有标星任务。
 */
export type ListScope = 'all' | 'starred';

export const LIST_SCOPES: readonly ListScope[] = ['all', 'starred'];

export const DEFAULT_LIST_SCOPE: ListScope = 'all';

/**
 * 状态（每个清单页面内、添加栏下面一行，单选）：全部 / 未完成 / 已完成 / 已错过。
 */
export type StatusFilter = 'all' | 'todo' | 'completed' | 'missed';

export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'todo', 'completed', 'missed'];

/** 默认状态：未完成 */
export const DEFAULT_STATUS_FILTER: StatusFilter = 'todo';

/** 内容 = 所选范围 ∩ 所选分类的并集 ∩ 所选状态。 */
export interface TaskListFilter {
  /** 默认"全部" */
  scope?: ListScope;
  status: StatusFilter;
  /** 选中的分类（多选，命中其一即显示）；为空表示所有分类 */
  categoryIds: readonly string[];
}

/**
 * 列表中显示的状态：
 * - 普通任务：由截止时间 / 完成时间派生（见 deriveTaskStatus）
 * - 循环任务：只要还有下一个实例就是"待办"（逾期规则不适用于循环任务的历史实例）；
 *   序列已结束（COUNT / UNTIL 用尽且都已处理）视为"已完成"
 */
export function deriveListStatus(
  task: Task,
  occurrences: readonly Pick<RecurrenceOccurrence, 'occurrenceDate' | 'status'>[],
  context: EvaluationContext,
): TaskStatus {
  const series = seriesFromTask(task);
  if (!series) return deriveTaskStatus(task, context.now);
  return resolveRepresentativeInstance(series, occurrences, context) ? 'todo' : 'completed';
}

export function matchesStatusFilter(
  task: Pick<Task, 'deadlineAt' | 'completedAt'>,
  filter: StatusFilter,
  now: Date,
): boolean {
  return filter === 'all' || deriveTaskStatus(task, now) === filter;
}

export function matchesScope(task: Pick<Task, 'isStarred'>, scope: ListScope): boolean {
  return scope === 'all' || task.isStarred;
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

/**
 * 主列表：去掉已删除任务，应用范围 + 分类 + 状态筛选，
 * 再按截止时间从近到远排序（无截止时间排最后）。
 */
export function buildTaskList(
  sources: TaskListSources,
  filter: TaskListFilter,
  context: EvaluationContext,
): Task[] {
  const scope = filter.scope ?? DEFAULT_LIST_SCOPE;
  const rows = sources.tasks
    .filter((task) => !task.deletedAt)
    .filter((task) => matchesScope(task, scope))
    .filter((task) =>
      matchesCategoryFilter(sources.categoryIdsByTask.get(task.id) ?? [], filter.categoryIds),
    )
    .filter((task) => {
      if (filter.status === 'all') return true;
      const occurrences = sources.occurrencesByTask?.get(task.id) ?? [];
      return deriveListStatus(task, occurrences, context) === filter.status;
    })
    .map((task) => ({
      id: task.id,
      createdAt: task.createdAt,
      deadlineAt: listDeadlineOf(task, sources.occurrencesByTask?.get(task.id) ?? [], context),
      task,
    }));
  return sortByDeadline(rows).map((row) => row.task);
}

/** 快速添加时新任务自动带上的分类：当前选中的全部分类；没选分类就不带。 */
export function categoriesForQuickAdd(selectedCategoryIds: readonly string[]): string[] {
  return [...new Set(selectedCategoryIds)];
}

/** 快速添加时新任务是否自动标星：在"收藏"里新建的任务自动标星。 */
export function starredForQuickAdd(scope: ListScope): boolean {
  return scope === 'starred';
}
