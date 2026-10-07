import {
  computeScheduleDates,
  dateOfInstant,
  taskHasRelations,
  waitingOn,
  type Category,
  type EndMode,
  type RelationRef,
  type Project,
  type ScheduledDates,
  type Task,
  type WaitingContext,
  type WaitingOn,
} from '@alethego/core';

import type { TaskListData } from '@/hooks/use-task-list-data';

/**
 * 任务关系在页面上用到的换算：哪些任务有两行逻辑、日期、等待、关系对象的候选。
 * 日期的计算本身在 packages/core/src/schedule。
 */

/** 任务的开始和结束日期（结束 = 截止时间在用户时区里的日期） */
export function taskDates(task: Task, timeZone: string): ScheduledDates {
  return {
    start: task.startOn,
    end: task.deadlineAt ? dateOfInstant(task.deadlineAt, timeZone) : null,
  };
}

/** 任务挂着的分类 */
export function categoriesOf(task: Task, data: TaskListData): Category[] {
  return (data.categoryIdsByTask.get(task.id) ?? [])
    .map((id) => data.categories.find((c) => c.id === id))
    .filter((c) => c !== undefined);
}

/** 这条任务有没有开始 / 结束两行逻辑 */
export function hasRelations(task: Task, data: TaskListData): boolean {
  const project = task.projectId ? data.projects.find((p) => p.id === task.projectId) : null;
  return taskHasRelations(task, project, categoriesOf(task, data));
}

export function waitingContext(data: TaskListData, today: string): WaitingContext {
  return {
    tasks: new Map(data.tasks.map((t) => [t.id, t])),
    relationsByTask: data.relationsByTask,
    today,
  };
}

/** 这条任务在等哪些（只看有两行逻辑、还没完成的任务） */
export function waitingOf(task: Task, data: TaskListData, today: string): WaitingOn[] {
  if (!hasRelations(task, data)) return [];
  return waitingOn(task.id, waitingContext(data, today), ['start']);
}

/** 选关系对象时的一个范围：组里是项目，个人是分类 */
export interface RelationScope {
  id: string;
  name: string;
  color: string;
  tasks: Task[];
}

/**
 * 关系对象的候选：
 * - 组里：同一组里、我能看到的、开了任务关系的项目里的任务
 * - 个人：挂了开有任务关系的分类的个人任务（按分类分组）
 * 循环任务、已删除的任务和这条任务自己不在其中
 */
export function relationScopes(task: Task, data: TaskListData): RelationScope[] {
  const eligible = (t: Task) => t.id !== task.id && !t.deletedAt && !t.recurrenceRule;
  if (task.groupId) {
    return data.projects
      .filter((p: Project) => p.groupId === task.groupId && p.tools.includes('relations'))
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        tasks: data.tasks.filter((t) => t.projectId === p.id && eligible(t)),
      }));
  }
  return data.categories
    .filter((c) => c.tools.includes('relations'))
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      tasks: data.tasks.filter(
        (t) =>
          t.groupId === null &&
          eligible(t) &&
          (data.categoryIdsByTask.get(t.id) ?? []).includes(c.id),
      ),
    }));
}

/** 选关系对象时，某个任务属于哪个范围：组任务是它的项目，个人任务是它第一个开了任务关系的分类 */
export function scopeIdOf(taskId: string, data: TaskListData): string {
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task) return '';
  if (task.projectId) return task.projectId;
  return categoriesOf(task, data).find((c) => c.tools.includes('relations'))?.id ?? '';
}

/** 详情里的这条任务现在（按表单里的分类和循环开关）有没有两行逻辑 */
export function scheduleEligible(
  task: Task,
  form: { categoryIds: readonly string[]; recurrence: { enabled: boolean } },
  data: TaskListData | null,
): boolean {
  if (!data) return false;
  const project = task.projectId ? data.projects.find((p) => p.id === task.projectId) : null;
  const categories = form.categoryIds
    .map((id) => data.categories.find((c) => c.id === id))
    .filter((c) => c !== undefined);
  return taskHasRelations(
    { recurrenceRule: form.recurrence.enabled ? 'on' : null, projectId: task.projectId },
    project,
    categories,
  );
}

/** 按表单里的两行逻辑算出开始和结束（预览） */
export function previewDates(
  schedule: {
    startMode: 'date' | 'relations';
    startOn: string;
    startRelations: readonly RelationRef[];
    endMode: EndMode;
    endAfterDays: number;
    endRelations: readonly RelationRef[];
  },
  endOn: string,
  data: TaskListData,
  timeZone: string,
): ScheduledDates {
  const valid = (refs: readonly RelationRef[]) => refs.filter((r) => r.predecessorId);
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  return computeScheduleDates(
    {
      startOn: schedule.startOn || null,
      startRelations: schedule.startMode === 'relations' ? valid(schedule.startRelations) : [],
      endMode: schedule.endMode,
      endOn: endOn || null,
      endAfterDays: schedule.endAfterDays,
      endRelations: valid(schedule.endRelations),
    },
    (id) => {
      const t = byId.get(id);
      return t && !t.deletedAt ? taskDates(t, timeZone) : undefined;
    },
  );
}
