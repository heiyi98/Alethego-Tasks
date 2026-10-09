import type { RecurrenceOccurrence } from '../domain/occurrence';
import type { Task } from '../domain/task';
import { deriveTaskStatus, type TaskStatus } from '../domain/task-status';
import { resolveRepresentativeInstance, seriesFromTask } from '../recurrence/recurrence-engine';
import { calendarDaysBetween, localDayNumber, type EvaluationContext } from '../time/zoned-time';
import { OVERDUE_MATRIX_GRACE_DAYS } from '../urgency/tiers';
import { listDeadlineOf, sortByDeadline } from './task-list-order';

/**
 * 范围（左侧菜单最上面三项，和分类、组、项目一起单选）：
 * 总览（我所有的个人任务）/ 今日 / 收藏（标星的个人任务）。
 */
export type ListScope = 'all' | 'today' | 'starred';

export const LIST_SCOPES: readonly ListScope[] = ['all', 'today', 'starred'];

export const DEFAULT_LIST_SCOPE: ListScope = 'all';

/**
 * 状态（每个清单页面内、添加栏下面一行，单选）：全部 / 未完成 / 已完成 / 已错过；
 * 管理组多一个"待确认"（已标记完成、还没确认）。
 */
export type StatusFilter = 'all' | 'todo' | 'completed' | 'missed' | 'pending';

export const STATUS_FILTERS: readonly StatusFilter[] = [
  'all',
  'todo',
  'completed',
  'missed',
  'pending',
];

/** 默认状态：未完成 */
export const DEFAULT_STATUS_FILTER: StatusFilter = 'todo';

/**
 * 内容 = 所选那一项（总览 / 今日 / 收藏 / 某个分类 / 某个组 / 组里的某个项目）∩ 所选状态。
 * 今日 = 我的个人任务和"和我有关的组任务"里，今天截止的、以及逾期不满 3 天还没完成的。
 */
export interface TaskListFilter {
  /** 容器：null / 不传 = 个人（总览）；组 id = 这个组的任务 */
  groupId?: string | null;
  /** 组里的某一个项目：只显示这个项目的任务；不传 = 组里所有项目 */
  projectId?: string | null;
  /** 默认"全部" */
  scope?: ListScope;
  status: StatusFilter;
  /** 选中的分类（命中其一即显示）；为空表示所有分类 */
  categoryIds: readonly string[];
  /** 今日用："和我有关的组任务"（见 isRelatedGroupTask） */
  isRelatedGroupTask?: (task: Task) => boolean;
}

/**
 * 今日：今天截止的任务（不管完成没有），以及逾期不满 3 天、还没完成的任务
 * （逾期满 3 天离开今日，和矩阵的逾期区一致，见 OVERDUE_MATRIX_GRACE_DAYS）。
 * 循环任务看它当前的代表实例。
 */
export function isTodayTask(
  task: Task,
  occurrences: readonly Pick<RecurrenceOccurrence, 'occurrenceDate' | 'status'>[],
  context: EvaluationContext,
): boolean {
  const deadline = listDeadlineOf(task, occurrences, context);
  if (!deadline) return false;
  if (
    localDayNumber(deadline, context.timeZone) === localDayNumber(context.now, context.timeZone)
  ) {
    return true;
  }
  if (deadline.getTime() >= context.now.getTime()) return false;
  if (deriveListStatus(task, occurrences, context) === 'completed') return false;
  return calendarDaysBetween(deadline, context.now, context.timeZone) < OVERDUE_MATRIX_GRACE_DAYS;
}

/**
 * "和我有关的组任务"：开了任务分配的项目里，我是执行人的任务；没开任务分配的项目里，
 * 我所在项目的全部任务（看得到的组任务都在我所在的项目里）。
 */
export function isRelatedGroupTask(
  task: Pick<Task, 'id' | 'projectId'>,
  context: {
    myUserId: string;
    projectHasAssignment: (projectId: string) => boolean;
    assignmentsOf: (taskId: string) => readonly { role: string; userId: string | null }[];
  },
): boolean {
  if (!task.projectId) return false;
  if (!context.projectHasAssignment(task.projectId)) return true;
  return context
    .assignmentsOf(task.id)
    .some((a) => a.role === 'R' && a.userId === context.myUserId);
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
  task: Pick<Task, 'deadlineAt' | 'completedAt'> & Partial<Pick<Task, 'confirmedAt'>>,
  filter: StatusFilter,
  now: Date,
): boolean {
  return filter === 'all' || deriveTaskStatus(task, now) === filter;
}

export function matchesScope(task: Pick<Task, 'isStarred'>, scope: ListScope): boolean {
  return scope !== 'starred' || task.isStarred;
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
  const groupId = filter.groupId ?? null;
  const today = groupId === null && scope === 'today';
  const occurrencesOf = (task: Task) => sources.occurrencesByTask?.get(task.id) ?? [];
  const rows = sources.tasks
    .filter((task) => !task.deletedAt)
    .filter((task) =>
      today
        ? task.groupId === null || (filter.isRelatedGroupTask?.(task) ?? false)
        : task.groupId === groupId,
    )
    .filter((task) => !filter.projectId || task.projectId === filter.projectId)
    .filter((task) => !today || isTodayTask(task, occurrencesOf(task), context))
    .filter((task) => groupId !== null || today || matchesScope(task, scope))
    .filter(
      (task) =>
        groupId !== null ||
        today ||
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

/** 快速添加时新任务自动带上的分类：在某个分类里新建就带上它；没选分类就不带。 */
export function categoriesForQuickAdd(selectedCategoryIds: readonly string[]): string[] {
  return [...new Set(selectedCategoryIds)];
}

/** 快速添加时新任务是否自动标星：在"收藏"里新建的任务自动标星。 */
export function starredForQuickAdd(scope: ListScope): boolean {
  return scope === 'starred';
}
